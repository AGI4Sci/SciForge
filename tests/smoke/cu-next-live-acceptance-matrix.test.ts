import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  approvalChainSidecarRefsFromEvidence,
} from '../../tools/computer-use-next/approval-chain.js';
import {
  projectCuNextTaskAcceptanceMarkers,
  type CuNextProjectedAcceptanceStatus,
  type CuNextTaskMarkerProjectionRefs,
} from '../../tools/computer-use-next/acceptance-projection.js';
import {
  CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES,
  validateCuNextLiveAcceptanceMatrix,
  validateCuNextLiveAcceptanceTaskEvidence,
  type CuNextLiveAcceptanceMarkerKind,
} from '../../tools/computer-use-next/live-acceptance-validator.js';
import {
  buildCuNextProductSmokeMatrix,
  CU_NEXT_LIVE_MATRIX_CLASSIFICATION_CASES,
  CU_NEXT_PRODUCT_SMOKE_CASES,
  validateCuNextProductSmokeMatrix,
  type CuNextProductSmokeCaseEvidence,
} from '../../tools/computer-use-next/product-smoke-matrix.js';
import { CU_NEXT_TASK_MAPPINGS } from '../../tools/computer-use-next/task-map.js';

type CuNextTaskId =
  | 'CU-NEXT-01'
  | 'CU-NEXT-02'
  | 'CU-NEXT-03'
  | 'CU-NEXT-04'
  | 'CU-NEXT-05'
  | 'CU-NEXT-06'
  | 'CU-NEXT-07'
  | 'CU-NEXT-08';

const expectedMarkerKinds: Record<CuNextTaskId, CuNextLiveAcceptanceMarkerKind> = {
  'CU-NEXT-01': 'briefing-deck',
  'CU-NEXT-02': 'chart-report',
  'CU-NEXT-03': 'needs-confirmation',
  'CU-NEXT-04': 'file-index',
  'CU-NEXT-05': 'repair-continuity',
  'CU-NEXT-06': 'approval-ref',
  'CU-NEXT-07': 'dense-grounding',
  'CU-NEXT-08': 'desktop-file-save',
};

test('CU-NEXT live acceptance semantic rules cover CU-NEXT-01..08 with task-specific markers', () => {
  assert.deepEqual(
    CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES.map((rule) => rule.taskId),
    Object.keys(expectedMarkerKinds),
  );
  for (const rule of CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES) {
    assert.equal(rule.markerKind, expectedMarkerKinds[rule.taskId as CuNextTaskId]);
  }
});

test('CU-NEXT-08 accepts desktop GUI save evidence and rejects workspace-writer assisted artifacts', () => {
  const valid = validateCuNextLiveAcceptanceTaskEvidence(liveAcceptanceInput('CU-NEXT-08'));
  assert.equal(valid.ok, true, valid.issues.map((issue) => `${issue.id}: ${issue.reason}`).join('\n'));
  assert.equal(valid.markerKind, 'desktop-file-save');

  const assisted = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-08',
    evidence: liveAcceptanceEvidence('CU-NEXT-08', {
      evidenceMarkers: [{
        ...taskMarker('CU-NEXT-08'),
        fileCreationOwner: 'workspace-file-writer-assisted',
      }],
    }),
    refRecords: acceptanceSupportRefRecords('CU-NEXT-08'),
  });
  assert.equal(assisted.ok, false);
  assert.ok(hasIssue(assisted, 'invalid-task-marker'));
  assert.match(assisted.issues.map((issue) => issue.reason).join('\n'), /workspace-file-writer-assisted|GUI save/i);
});

test('CU-NEXT product smoke matrix distinguishes package diagnostic, platform smoke, and product smoke gates', () => {
  assert.deepEqual(
    CU_NEXT_PRODUCT_SMOKE_CASES.map((item) => item.id),
    [
      'product-path-codex-native-plugin-sidecar',
      'virtual-app-screen-user-acceptance',
      'real-single-app-input',
      'real-artifact-save',
      'high-risk-confirmation-stop',
      'blocked-recovery',
      'viewer-real-frames',
      'multi-app-workflow',
      'current-bundle-evidence',
      'single-screen-single-actor',
      'single-screen-multi-actor',
      'multi-screen-single-actor',
      'multi-screen-multi-actor',
      'multi-screen-live-demo',
      'browser-runtime-dom-ax-observation',
      'dom-aware-observe-before-mutate',
      'window-local-queue',
      'screen-global-queue',
      'directory-preview',
    ],
  );
  for (const item of CU_NEXT_PRODUCT_SMOKE_CASES) {
    if (item.id === 'multi-screen-live-demo') {
      assert.equal(item.requiredTier, 'historical-regression');
      assert.equal(item.gateRole, 'historical-opt-in-regression');
    } else {
      assert.equal(item.requiredTier, 'product-smoke');
      assert.notEqual(item.gateRole, 'historical-opt-in-regression');
    }
    assert.equal(item.requiredExecutionMode, 'opt-in-live-backend');
  }
  assert.equal(
    CU_NEXT_PRODUCT_SMOKE_CASES.find((item) => item.id === 'real-artifact-save')?.taskId,
    'CU-NEXT-08',
  );
  const requirements = new Set<string>(CU_NEXT_PRODUCT_SMOKE_CASES.flatMap((item) => item.requirements));
  for (const requirement of [
    'codex-app-server-native-plugin-path',
    'sciforge-computer-use-provider',
    'platform-sidecar-isolation',
    'virtual-app-screen-user-acceptance',
    'virtual-app-screen-user-acceptance-manifest',
    'real-single-app-input',
    'real-artifact-save',
    'high-risk-confirmation-stop',
    'blocked-recovery',
    'viewer-real-frames',
    'multi-app-workflow',
    'current-bundle-evidence',
    'native-multi-screen-sidecar',
    'multi-screen-live-demo',
    'multi-screen-multi-actor',
    'multi-actor-cursor-provenance',
    'browser-runtime-dom-ax-observation',
    'dom-aware-observe-before-mutate',
  ]) {
    assert.ok(requirements.has(requirement), requirement);
  }
});

test('CU-NEXT live matrix dry-run classification covers actor/screen/queue cases without passing product smoke', () => {
  const matrix = buildCuNextProductSmokeMatrix({ generatedAt: '2026-05-31T00:00:00.000Z' });
  const result = validateCuNextProductSmokeMatrix(matrix);

  assert.equal(result.ok, true, result.issues.map((issue) => issue.reason).join('\n'));
  assert.equal(matrix.status, 'opt-in-required');
  assert.deepEqual(result.passedCaseIds, []);
  assert.deepEqual(
    CU_NEXT_LIVE_MATRIX_CLASSIFICATION_CASES.map((item) => item.id).filter((id) => id.includes('screen') || id.includes('queue')),
    [
      'virtual-app-screen-user-acceptance',
      'single-screen-single-actor',
      'single-screen-multi-actor',
      'multi-screen-single-actor',
      'multi-screen-multi-actor',
      'multi-screen-live-demo',
      'window-local-queue',
      'screen-global-queue',
    ],
  );
  for (const item of matrix.cases) {
    assert.notEqual(item.status, 'passed');
    assert.equal(item.realBackendExecuted, false);
    assert.ok(item.notRunReason?.includes('opt-in'));
  }
});

test('CU-NEXT product smoke matrix accepts VirtualAppScreen user-level manifest as active gate', () => {
  const manifestRef = ref('CU-NEXT-07', 'virtual-app-screen-user-acceptance-manifest.json');
  const liveCase: CuNextProductSmokeCaseEvidence = {
    id: 'virtual-app-screen-user-acceptance',
    status: 'passed',
    evidenceTier: 'product-smoke',
    executionMode: 'opt-in-live-backend',
    realBackendExecuted: true,
    userAcceptanceGate: 'virtual-app-screen-user-acceptance',
    userAcceptanceEligible: true,
    productPath: {
      entrypoint: 'Codex app-server native plugin',
      hops: ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use', 'platform-sidecar'],
      backendKind: 'platform-sidecar',
      appServerRunRef: ref('CU-NEXT-07', 'app-server-run.json'),
      nativePluginInvocationRef: ref('CU-NEXT-07', 'native-plugin-invocation.json'),
      sciforgeComputerUseRunTaskRef: ref('CU-NEXT-07', 'run-task.json'),
      platformSidecarIsolationReportRef: ref('CU-NEXT-07', 'sidecar-isolation.json'),
    },
    evidenceRefs: {
      'virtual-app-screen-user-acceptance': [ref('CU-NEXT-07', 'evidence-ledger.json')],
      'virtual-app-screen-user-acceptance-manifest': [manifestRef],
      'viewer-real-frames': [ref('CU-NEXT-07', 'frames/after.png')],
      'real-artifact-save': [ref('CU-NEXT-07', 'artifacts/research-note.md')],
      'current-bundle-evidence': [ref('CU-NEXT-07', 'current-bundle.json')],
    },
    currentRunBundleRef: `.sciforge/vision-runs/${runId('CU-NEXT-07')}`,
    acceptanceManifestRef: manifestRef,
    virtualAppScreenUserAcceptanceManifestRef: manifestRef,
  };

  const result = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      [manifestRef]: virtualAppScreenUserAcceptanceManifest('CU-NEXT-07'),
    },
  });

  assert.equal(result.ok, true, result.issues.map((issue) => issue.reason).join('\n'));
  assert.deepEqual(result.passedCaseIds, ['virtual-app-screen-user-acceptance']);

  const m6SubstituteManifest = virtualAppScreenUserAcceptanceManifest('CU-NEXT-07', {
    evidenceClaims: [
      {
        id: 'm6-only',
        kind: 'm6-native-multi-screen',
        completionEvidence: true,
        userAcceptanceEligible: true,
      },
    ],
    validation: {
      ok: false,
      issues: ['non-substitute evidence cannot be marked userAcceptanceEligible: m6-native-multi-screen.'],
      missingRefs: [],
      rejectedClaimKinds: ['m6-native-multi-screen'],
    },
  });
  const rejected = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      [manifestRef]: m6SubstituteManifest,
    },
  });

  assert.equal(rejected.ok, false);
  assert.ok(productSmokeIssue(rejected, 'invalid-virtual-app-screen-user-acceptance-validation'));
  assert.ok(productSmokeIssue(rejected, 'virtual-app-screen-rejected-substitute-claims'));

  const missingBlockedReasonManifest = virtualAppScreenUserAcceptanceManifest('CU-NEXT-07');
  delete missingBlockedReasonManifest.blockedReason;
  const missingBlockedReason = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      [manifestRef]: missingBlockedReasonManifest,
    },
  });

  assert.equal(missingBlockedReason.ok, false);
  assert.ok(productSmokeIssue(missingBlockedReason, 'invalid-virtual-app-screen-user-acceptance-manifest'));

  const missingLedgerActionsManifest = virtualAppScreenUserAcceptanceManifest('CU-NEXT-07');
  delete missingLedgerActionsManifest.evidenceLedgerActions;
  const missingLedgerActions = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      [manifestRef]: missingLedgerActionsManifest,
    },
  });

  assert.equal(missingLedgerActions.ok, false);
  assert.ok(productSmokeIssue(missingLedgerActions, 'invalid-virtual-app-screen-evidence-ledger'));

  const crossBundleLedgerManifest = virtualAppScreenUserAcceptanceManifest('CU-NEXT-07');
  (crossBundleLedgerManifest.evidenceLedgerActions as Array<Record<string, unknown>>)[0].inputIntentRef =
    ref('CU-NEXT-04', 'input-intents/highlight-title.json');
  const crossBundleLedger = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      [manifestRef]: crossBundleLedgerManifest,
    },
  });

  assert.equal(crossBundleLedger.ok, false);
  assert.ok(productSmokeIssue(crossBundleLedger, 'product-smoke-ref-outside-current-bundle'));
});

test('CU-NEXT product smoke matrix keeps M6 as historical native multi-screen regression', () => {
  const liveCase: CuNextProductSmokeCaseEvidence = {
    id: 'multi-screen-live-demo',
    status: 'passed',
    evidenceTier: 'historical-regression',
    executionMode: 'opt-in-live-backend',
    realBackendExecuted: true,
    historicalRegression: true,
    productPath: {
      entrypoint: 'Codex app-server native plugin',
      hops: ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use', 'native-multi-screen-sidecar'],
      backendKind: 'native-multi-screen-sidecar',
      appServerRunRef: ref('CU-NEXT-07', 'app-server-run.json'),
      nativePluginInvocationRef: ref('CU-NEXT-07', 'native-plugin-invocation.json'),
      sciforgeComputerUseRunTaskRef: ref('CU-NEXT-07', 'run-task.json'),
      platformSidecarIsolationReportRef: ref('CU-NEXT-07', 'sidecar-isolation.json'),
    },
    evidenceRefs: {
      'multi-screen-live-demo': [ref('CU-NEXT-07', 'm6-live-demo.json')],
      'multi-screen-multi-actor': [ref('CU-NEXT-07', 'display-group.json')],
      'multi-actor-cursor-provenance': [ref('CU-NEXT-07', 'actor-cursors.jsonl')],
      'native-multi-screen-sidecar': [ref('CU-NEXT-07', 'sidecar-isolation.json')],
      'window-local-queue': [ref('CU-NEXT-07', 'window-local-queue.json')],
      'screen-global-queue': [ref('CU-NEXT-07', 'screen-global-queue.json')],
      'viewer-real-frames': [ref('CU-NEXT-07', 'replay-bundle.json')],
      'current-bundle-evidence': [ref('CU-NEXT-07', 'current-bundle.json')],
    },
    currentRunBundleRef: `.sciforge/vision-runs/${runId('CU-NEXT-07')}`,
    regressionManifestRef: ref('CU-NEXT-07', 'm6-regression-manifest.json'),
  };
  const matrix = buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  });

  const result = validateCuNextProductSmokeMatrix(matrix);

  assert.equal(result.ok, false);
  assert.ok(productSmokeIssue(result, 'missing-native-multi-screen-summary'));

  const validationRef = ref('CU-NEXT-07', 'm6-live-demo-validation.json');
  const currentBundleRef = ref('CU-NEXT-07', 'current-bundle.json');
  const sidecarBindingRef = ref('CU-NEXT-07', 'sidecar-binding.json');
  const sidecarCapabilitiesRef = ref('CU-NEXT-07', 'sidecar-capabilities.json');
  const sidecarDiscoveryRef = ref('CU-NEXT-07', 'sidecar-discovery.json');
  const schedulerLeaseRefs = [
    ref('CU-NEXT-07', 'leases/lease-1.json'),
    ref('CU-NEXT-07', 'leases/lease-2.json'),
  ];
  const replayRef = ref('CU-NEXT-07', 'replay-bundle.json');
  const targetRefs = [
    ref('CU-NEXT-07', 'targets/target-1.json'),
    ref('CU-NEXT-07', 'targets/target-2.json'),
  ];
  const frameRefs = [
    ref('CU-NEXT-07', 'frames/screen-main-before.png'),
    ref('CU-NEXT-07', 'frames/screen-preview-before.png'),
  ];
  const timelineRefs = [
    ref('CU-NEXT-07', 'timeline/frame-before-main.json'),
    ref('CU-NEXT-07', 'timeline/frame-after-main.json'),
    ref('CU-NEXT-07', 'timeline/cursor-move.json'),
    ref('CU-NEXT-07', 'timeline/cursor-point.json'),
    ref('CU-NEXT-07', 'timeline/cursor-annotate.json'),
    ref('CU-NEXT-07', 'timeline/proposal-main.json'),
    ref('CU-NEXT-07', 'timeline/lease-acquired.json'),
    ref('CU-NEXT-07', 'timeline/lease-released.json'),
    ref('CU-NEXT-07', 'timeline/executor-event.json'),
  ];
  const replayPayload = {
    schemaVersion: 'sciforge.computer-use.replay-bundle.v1',
    ref: replayRef,
    frames: [
      {
        screenId: `${runId('CU-NEXT-07')}-screen-main`,
        frameRef: frameRefs[0],
        screenshotRef: frameRefs[0],
        cursorOverlayRefs: [ref('CU-NEXT-07', 'cursor-overlays/main-before.json')],
        sourceEvidenceRefs: [frameRefs[0]],
      },
      {
        screenId: `${runId('CU-NEXT-07')}-screen-preview`,
        frameRef: frameRefs[1],
        screenshotRef: frameRefs[1],
        cursorOverlayRefs: [ref('CU-NEXT-07', 'cursor-overlays/preview-before.json')],
        sourceEvidenceRefs: [frameRefs[1]],
      },
    ],
    cursorOverlayRefs: [
      ref('CU-NEXT-07', 'cursor-overlays/main-before.json'),
      ref('CU-NEXT-07', 'cursor-overlays/preview-before.json'),
    ],
    leaseOwnerRefs: schedulerLeaseRefs,
    beforeEvidenceRefs: frameRefs,
    afterEvidenceRefs: frameRefs,
    timeline: {
      schemaVersion: 'sciforge.computer-use.replay-timeline.v1',
      events: [
        { eventKind: 'frame-before', eventRef: timelineRefs[0], screenId: `${runId('CU-NEXT-07')}-screen-main`, frameRef: frameRefs[0] },
        { eventKind: 'frame-after', eventRef: timelineRefs[1], screenId: `${runId('CU-NEXT-07')}-screen-main`, frameRef: frameRefs[0] },
        { eventKind: 'cursor-move', eventRef: timelineRefs[2], actorId: `${runId('CU-NEXT-07')}-actor-agent`, cursorId: `${runId('CU-NEXT-07')}-cursor-agent` },
        { eventKind: 'cursor-point', eventRef: timelineRefs[3], actorId: `${runId('CU-NEXT-07')}-actor-writer`, cursorId: `${runId('CU-NEXT-07')}-cursor-writer` },
        { eventKind: 'cursor-annotate', eventRef: timelineRefs[4], actorId: `${runId('CU-NEXT-07')}-actor-preview`, cursorId: `${runId('CU-NEXT-07')}-cursor-preview` },
        { eventKind: 'action-proposal', eventRef: timelineRefs[5], schedulerLeaseRef: schedulerLeaseRefs[0] },
        { eventKind: 'lease-acquired', eventRef: timelineRefs[6], schedulerLeaseRef: schedulerLeaseRefs[0] },
        { eventKind: 'lease-released', eventRef: timelineRefs[7], schedulerLeaseRef: schedulerLeaseRefs[1] },
        { eventKind: 'executor-event', eventRef: timelineRefs[8], schedulerLeaseRef: schedulerLeaseRefs[0] },
      ],
    },
  };
  const validationPayload = {
    schemaVersion: 'sciforge.computer-use.native-multi-screen-live-demo-validation.v1',
    ok: true,
    status: 'accepted',
    errorCount: 0,
    realNativeSidecarExecuted: true,
    completionEligible: true,
    screenCount: 2,
    actorCursorCount: 3,
    cursorEventTypes: ['move', 'point', 'annotate'],
    windowLocalQueue: true,
    screenGlobalQueue: true,
    nonPlaceholderReplayScreenCount: 2,
    sidecarBindingKind: 'external-command',
  };
  const validationRefPayload = {
    schemaVersion: validationPayload.schemaVersion,
    ok: validationPayload.ok,
    status: validationPayload.status,
    errorCount: validationPayload.errorCount,
    runId: runId('CU-NEXT-07'),
    currentBundleRef,
    sidecarBindingRef,
    sidecarCapabilitiesRef,
    sidecarDiscoveryRef,
    schedulerLeaseRefs,
    replayRef,
    targetRefs,
    refs: [
      currentBundleRef,
      sidecarBindingRef,
      sidecarCapabilitiesRef,
      sidecarDiscoveryRef,
      ...schedulerLeaseRefs,
      replayRef,
      ...targetRefs,
      ...frameRefs,
      ...timelineRefs,
    ],
    sidecarBinding: {
      schemaVersion: 'sciforge.computer-use.native-multi-screen-sidecar-binding.v1',
      bindingKind: validationPayload.sidecarBindingKind,
      executable: '/Applications/SciForge Native Sidecar.app/Contents/MacOS/sciforge-native-sidecar',
      commandDigest: 'sha256-native-sidecar-contract',
      dockerNovncRequired: false,
    },
    sidecarCapabilities: {
      schemaVersion: 'sciforge.computer-use.native-sidecar-capabilities.v1',
      features: ['multi-screen', 'multi-actor-cursor', 'window-local-lease', 'screen-global-lease', 'refs-first-evidence'],
      tools: ['capabilities', 'preflight', 'capture', 'state', 'execute', 'discover'],
      planningPerformed: false,
      completionJudged: false,
      sharedSystemInputAllowed: false,
      dockerNovncRequired: false,
    },
    sidecarDiscovery: {
      schemaVersion: 'sciforge.computer-use.native-sidecar-discovery.v1',
      screens: [
        { screenId: `${runId('CU-NEXT-07')}-screen-main` },
        { screenId: `${runId('CU-NEXT-07')}-screen-preview` },
      ],
      windows: [
        { windowId: `${runId('CU-NEXT-07')}-window-main`, windowRef: 'native-window-ref-main' },
        { windowId: `${runId('CU-NEXT-07')}-window-preview`, windowRef: 'native-window-ref-preview' },
      ],
      actorCursorPlan: [
        { actorId: `${runId('CU-NEXT-07')}-actor-agent`, cursorId: `${runId('CU-NEXT-07')}-cursor-agent`, screenId: `${runId('CU-NEXT-07')}-screen-main`, windowId: `${runId('CU-NEXT-07')}-window-main` },
        { actorId: `${runId('CU-NEXT-07')}-actor-writer`, cursorId: `${runId('CU-NEXT-07')}-cursor-writer`, screenId: `${runId('CU-NEXT-07')}-screen-main`, windowId: `${runId('CU-NEXT-07')}-window-main` },
        { actorId: `${runId('CU-NEXT-07')}-actor-preview`, cursorId: `${runId('CU-NEXT-07')}-cursor-preview`, screenId: `${runId('CU-NEXT-07')}-screen-preview`, windowId: `${runId('CU-NEXT-07')}-window-preview` },
      ],
    },
    currentBundle: {
      schemaVersion: 'sciforge.computer-use.current-bundle.v1',
      runId: runId('CU-NEXT-07'),
      refs: [
        sidecarBindingRef,
        sidecarCapabilitiesRef,
        sidecarDiscoveryRef,
        ...schedulerLeaseRefs,
        replayRef,
        ...targetRefs,
        ...frameRefs,
        ...timelineRefs,
      ],
    },
    replay: replayPayload,
    summary: {
      realNativeSidecarExecuted: validationPayload.realNativeSidecarExecuted,
      completionEligible: validationPayload.completionEligible,
      screenCount: validationPayload.screenCount,
      actorCursorCount: validationPayload.actorCursorCount,
      cursorEventTypes: validationPayload.cursorEventTypes,
      windowLocalQueue: validationPayload.windowLocalQueue,
      screenGlobalQueue: validationPayload.screenGlobalQueue,
      nonPlaceholderReplayScreenCount: validationPayload.nonPlaceholderReplayScreenCount,
      sidecarBindingKind: validationPayload.sidecarBindingKind,
    },
  };
  const productSmokeRefRecords = {
    [validationRef]: validationRefPayload,
    [currentBundleRef]: validationRefPayload.currentBundle,
    [sidecarBindingRef]: validationRefPayload.sidecarBinding,
    [sidecarCapabilitiesRef]: validationRefPayload.sidecarCapabilities,
    [sidecarDiscoveryRef]: validationRefPayload.sidecarDiscovery,
    [replayRef]: replayPayload,
    [schedulerLeaseRefs[0]]: {
      schemaVersion: 'sciforge.computer-use.scheduler-lease.v1',
      leaseId: `${runId('CU-NEXT-07')}-lease-main`,
      scope: 'window-local',
      screenId: `${runId('CU-NEXT-07')}-screen-main`,
      windowId: `${runId('CU-NEXT-07')}-window-main`,
      actorId: `${runId('CU-NEXT-07')}-actor-agent`,
      cursorId: `${runId('CU-NEXT-07')}-cursor-agent`,
      sharedSystemInputUsed: false,
    },
    [schedulerLeaseRefs[1]]: {
      schemaVersion: 'sciforge.computer-use.scheduler-lease.v1',
      leaseId: `${runId('CU-NEXT-07')}-lease-preview`,
      scope: 'screen-global',
      screenId: `${runId('CU-NEXT-07')}-screen-preview`,
      actorId: `${runId('CU-NEXT-07')}-actor-preview`,
      cursorId: `${runId('CU-NEXT-07')}-cursor-preview`,
      sharedSystemInputUsed: false,
    },
    [targetRefs[0]]: {
      schemaVersion: 'sciforge.computer-use.target-ref.v1',
      targetId: `${runId('CU-NEXT-07')}-target-main`,
      screenId: `${runId('CU-NEXT-07')}-screen-main`,
      windowRef: 'native-window-ref-main',
    },
    [targetRefs[1]]: {
      schemaVersion: 'sciforge.computer-use.target-ref.v1',
      targetId: `${runId('CU-NEXT-07')}-target-preview`,
      screenId: `${runId('CU-NEXT-07')}-screen-preview`,
      windowRef: 'native-window-ref-preview',
    },
    [frameRefs[0]]: {
      contentType: 'image/png',
      byteLength: 2048,
      screenId: `${runId('CU-NEXT-07')}-screen-main`,
    },
    [frameRefs[1]]: {
      contentType: 'image/png',
      byteLength: 2048,
      screenId: `${runId('CU-NEXT-07')}-screen-preview`,
    },
  };
  liveCase.nativeMultiScreenSummary = {
    screenCount: 2,
    actorCursorCount: 3,
    cursorEventTypes: ['move', 'point', 'annotate'],
    windowLocalQueue: true,
    screenGlobalQueue: true,
    nonPlaceholderReplayScreenCount: 2,
    validationRef,
    validation: validationPayload,
  };
  const claimOnly = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }));
  assert.ok(productSmokeIssue(claimOnly, 'missing-native-multi-screen-validation-ref-record'));

  const summaryOnlyRecord = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      [validationRef]: {
        schemaVersion: validationRefPayload.schemaVersion,
        ok: validationRefPayload.ok,
        status: validationRefPayload.status,
        errorCount: validationRefPayload.errorCount,
        summary: validationRefPayload.summary,
      },
    },
  });
  assert.ok(productSmokeIssue(summaryOnlyRecord, 'missing-native-multi-screen-validation-ref-proof'));

  const accepted = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), { refRecords: productSmokeRefRecords });
  assert.equal(productSmokeIssue(accepted, 'missing-native-multi-screen-summary'), false);
  assert.equal(productSmokeIssue(accepted, 'invalid-native-multi-screen-summary'), false);
  assert.equal(productSmokeIssue(accepted, 'missing-native-multi-screen-validation'), false);
  assert.equal(productSmokeIssue(accepted, 'missing-native-multi-screen-validation-ref-record'), false);
  assert.equal(productSmokeIssue(accepted, 'missing-native-multi-screen-validation-ref-proof'), false);
  assert.equal(productSmokeIssue(accepted, 'invalid-native-multi-screen-validation-ref-proof'), false);
  assert.equal(productSmokeIssue(accepted, 'missing-product-smoke-loaded-ref'), false);
  assert.equal(productSmokeIssue(accepted, 'invalid-current-bundle-ref-proof'), false);
  assert.equal(productSmokeIssue(accepted, 'invalid-product-smoke-replay-proof'), false);
  assert.equal(productSmokeIssue(accepted, 'forbidden-placeholder-viewer'), false);
  assert.equal(accepted.ok, true, accepted.issues.map((issue) => issue.reason).join('\n'));
  assert.deepEqual(accepted.passedCaseIds, [], 'historical M6 regression must not count as an active user-level product pass');

  for (const [name, refToRemove] of Object.entries({
    currentBundleRef,
    replayRef,
    sidecarCapabilitiesRef,
    sidecarDiscoveryRef,
    schedulerLeaseRef: schedulerLeaseRefs[0],
    targetRef: targetRefs[0],
    frameRef: frameRefs[0],
  })) {
    const missingLoadedRefRecords = { ...productSmokeRefRecords };
    delete (missingLoadedRefRecords as Record<string, unknown>)[refToRemove];
    const missingLoadedRefResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
      cases: [
        liveCase,
        ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
      ],
    }), { refRecords: missingLoadedRefRecords });
    assert.ok(productSmokeIssue(missingLoadedRefResult, 'missing-product-smoke-loaded-ref'), name);
  }

  const placeholderReplayResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [replayRef]: {
        ...replayPayload,
        frames: replayPayload.frames.map((frame) => ({ ...frame, placeholder: true })),
      },
    },
  });
  assert.ok(productSmokeIssue(placeholderReplayResult, 'forbidden-placeholder-viewer'));

  const jsonFrameRefResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [frameRefs[0]]: {
        contentType: 'application/json',
        schemaVersion: 'sciforge.computer-use.native-capture.v1',
      },
    },
  });
  assert.ok(productSmokeIssue(jsonFrameRefResult, 'invalid-product-smoke-replay-proof'));

  const rawInlinePayloadResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [replayRef]: {
        ...replayPayload,
        rawPayload: { screenshotBase64: 'data:image/png;base64,AAAA' },
      },
    },
  });
  assert.ok(productSmokeIssue(rawInlinePayloadResult, 'forbidden-raw-inline-payload'));

  const invalidSchedulerLeaseResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [schedulerLeaseRefs[0]]: {
        ...(productSmokeRefRecords as Record<string, Record<string, unknown>>)[schedulerLeaseRefs[0]],
        scope: 'screen-global',
        actorId: undefined,
      },
    },
  });
  assert.ok(productSmokeIssue(invalidSchedulerLeaseResult, 'invalid-native-scheduler-lease-proof'));

  const missingTimelineResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [replayRef]: {
        ...replayPayload,
        timeline: { schemaVersion: 'sciforge.computer-use.replay-timeline.v1', events: [] },
      },
    },
  });
  assert.ok(productSmokeIssue(missingTimelineResult, 'invalid-product-smoke-timeline-proof'));

  const browserSubstituteResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [replayRef]: {
        ...replayPayload,
        browserRuntimeDomAxObservation: {
          kind: 'browser-runtime-dom-ax-observation',
          executorLeaseSubstitute: true,
          completionEvidenceEligible: true,
        },
      },
    },
  });
  assert.ok(productSmokeIssue(browserSubstituteResult, 'forbidden-browser-dom-ax-substitute'));

  const crossBundleFrameRef = ref('CU-NEXT-04', 'frames/foreign-screen.png');
  const crossBundleFrameResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [replayRef]: {
        ...replayPayload,
        frames: [
          { ...replayPayload.frames[0], frameRef: crossBundleFrameRef, screenshotRef: crossBundleFrameRef },
          replayPayload.frames[1],
        ],
      },
      [crossBundleFrameRef]: { contentType: 'image/png', byteLength: 2048 },
    },
  });
  assert.ok(productSmokeIssue(crossBundleFrameResult, 'product-smoke-ref-outside-current-bundle'));

  const mismatched = structuredClone(liveCase);
  mismatched.nativeMultiScreenSummary = {
    ...liveCase.nativeMultiScreenSummary,
    validation: {
      ...liveCase.nativeMultiScreenSummary.validation,
      actorCursorCount: 2,
    },
  };
  const mismatchResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      mismatched,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), { refRecords: productSmokeRefRecords });
  assert.ok(productSmokeIssue(mismatchResult, 'native-multi-screen-validation-summary-mismatch'));
  assert.ok(productSmokeIssue(mismatchResult, 'native-multi-screen-validation-ref-mismatch'));

  const diagnosticLocal = structuredClone(liveCase);
  diagnosticLocal.nativeMultiScreenSummary = {
    ...liveCase.nativeMultiScreenSummary,
    validation: {
      ...liveCase.nativeMultiScreenSummary.validation,
      sidecarBindingKind: 'diagnostic-local',
    },
  };
  const diagnosticLocalPayload = structuredClone(validationRefPayload) as Record<string, unknown>;
  diagnosticLocalPayload.sidecarBinding = {
    ...(diagnosticLocalPayload.sidecarBinding as Record<string, unknown>),
    bindingKind: 'diagnostic-local',
  };
  diagnosticLocalPayload.summary = {
    ...(diagnosticLocalPayload.summary as Record<string, unknown>),
    sidecarBindingKind: 'diagnostic-local',
  };
  const diagnosticLocalResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      diagnosticLocal,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [validationRef]: diagnosticLocalPayload,
      [sidecarBindingRef]: diagnosticLocalPayload.sidecarBinding,
    },
  });
  assert.ok(productSmokeIssue(diagnosticLocalResult, 'invalid-native-multi-screen-validation-ref-proof'));

  const customDispatcher = structuredClone(liveCase);
  customDispatcher.nativeMultiScreenSummary = {
    ...liveCase.nativeMultiScreenSummary,
    validation: {
      ...liveCase.nativeMultiScreenSummary.validation,
      sidecarBindingKind: 'custom-dispatcher',
    },
  };
  const customDispatcherPayload = structuredClone(validationRefPayload) as Record<string, unknown>;
  customDispatcherPayload.sidecarBinding = {
    ...(customDispatcherPayload.sidecarBinding as Record<string, unknown>),
    bindingKind: 'custom-dispatcher',
  };
  customDispatcherPayload.summary = {
    ...(customDispatcherPayload.summary as Record<string, unknown>),
    sidecarBindingKind: 'custom-dispatcher',
  };
  const customDispatcherResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      customDispatcher,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), {
    refRecords: {
      ...productSmokeRefRecords,
      [validationRef]: customDispatcherPayload,
      [sidecarBindingRef]: customDispatcherPayload.sidecarBinding,
    },
  });
  assert.ok(productSmokeIssue(customDispatcherResult, 'invalid-native-multi-screen-validation-ref-proof'));

  const missingDiscoveryCapabilityPayload = structuredClone(validationRefPayload) as Record<string, unknown>;
  delete missingDiscoveryCapabilityPayload.sidecarCapabilitiesRef;
  delete missingDiscoveryCapabilityPayload.sidecarDiscoveryRef;
  const missingDiscoveryCapabilityResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), { refRecords: { ...productSmokeRefRecords, [validationRef]: missingDiscoveryCapabilityPayload } });
  assert.ok(productSmokeIssue(missingDiscoveryCapabilityResult, 'missing-native-multi-screen-validation-ref-proof'));

  const unsafeRef = structuredClone(liveCase);
  unsafeRef.evidenceRefs = {
    ...unsafeRef.evidenceRefs,
    'multi-screen-live-demo': ['https://example.test/old-run.json'],
  };
  const unsafeRefResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      unsafeRef,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), { refRecords: productSmokeRefRecords });
  assert.ok(productSmokeIssue(unsafeRefResult, 'unsafe-product-smoke-ref'));

  const crossBundleRef = structuredClone(liveCase);
  crossBundleRef.evidenceRefs = {
    ...crossBundleRef.evidenceRefs,
    'multi-screen-live-demo': [ref('CU-NEXT-04', 'm6-live-demo.json')],
  };
  const crossBundleRefResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      crossBundleRef,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), { refRecords: productSmokeRefRecords });
  assert.ok(productSmokeIssue(crossBundleRefResult, 'product-smoke-ref-outside-current-bundle'));

  const crossBundleValidationPayload = structuredClone(validationRefPayload) as Record<string, unknown>;
  crossBundleValidationPayload.sidecarDiscoveryRef = ref('CU-NEXT-04', 'sidecar-discovery.json');
  crossBundleValidationPayload.refs = [
    ...(validationRefPayload.refs.filter((item) => item !== sidecarDiscoveryRef)),
    crossBundleValidationPayload.sidecarDiscoveryRef,
  ];
  const crossBundleValidationResult = validateCuNextProductSmokeMatrix(buildCuNextProductSmokeMatrix({
    cases: [
      liveCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== liveCase.id),
    ],
  }), { refRecords: { ...productSmokeRefRecords, [validationRef]: crossBundleValidationPayload } });
  assert.ok(productSmokeIssue(crossBundleValidationResult, 'product-smoke-ref-outside-current-bundle'));
});

test('CU-NEXT product smoke matrix rejects package diagnostic and dry-run pass claims', () => {
  const diagnosticCase: CuNextProductSmokeCaseEvidence = {
    id: 'real-single-app-input',
    status: 'passed',
    evidenceTier: 'package-diagnostic',
    executionMode: 'dry-run',
    realBackendExecuted: false,
    packageDiagnosticOnly: true,
    dryRun: true,
    productPath: {
      entrypoint: 'package-local native_tool diagnostic',
      hops: ['package-local'],
    },
    evidenceRefs: {
      'real-single-app-input': ['.sciforge/vision-runs/package-diagnostic/vision-trace.json'],
    },
    currentRunBundleRef: '.sciforge/vision-runs/package-diagnostic',
    acceptanceManifestRef: '.sciforge/vision-runs/package-diagnostic/cu-user-acceptance-manifest.json',
  };
  const matrix = buildCuNextProductSmokeMatrix({
    cases: [
      diagnosticCase,
      ...buildCuNextProductSmokeMatrix().cases.filter((item) => item.id !== diagnosticCase.id),
    ],
  });

  const result = validateCuNextProductSmokeMatrix(matrix);

  assert.equal(result.ok, false);
  assert.ok(productSmokeIssue(result, 'product-smoke-pass-without-real-backend'));
  assert.ok(productSmokeIssue(result, 'non-product-tier-cannot-pass-product-smoke'));
  assert.ok(productSmokeIssue(result, 'product-smoke-pass-requires-opt-in-live-backend'));
  assert.ok(productSmokeIssue(result, 'diagnostic-cannot-pass-product-smoke'));
  assert.ok(productSmokeIssue(result, 'missing-product-path-hop'));
});

test('CU-NEXT live acceptance matrix accepts complete task-level semantic evidence markers', () => {
  const inputs = (Object.keys(expectedMarkerKinds) as CuNextTaskId[]).map((taskId) => liveAcceptanceInput(taskId));
  for (const input of inputs) {
    assertHasSciForgeChatOriginProof(input.taskId, input.evidence);
  }

  const results = validateCuNextLiveAcceptanceMatrix(inputs);

  assert.deepEqual(results.map((result) => result.ok), Object.keys(expectedMarkerKinds).map(() => true));
  assert.deepEqual(results.map((result) => result.markerKind), Object.values(expectedMarkerKinds));
  for (const result of results) {
    assert.equal(result.checks.exactTaskId, true, result.taskId);
    assert.equal(result.checks.scenarioMapped, true, result.taskId);
    assert.equal(result.checks.requiredRefs, true, result.taskId);
    assert.equal(result.checks.disqualifiersClean, true, result.taskId);
    assert.equal(result.checks.taskMarker, true, result.taskId);
  }
});

test('CU-NEXT live acceptance rejects evidence without SciForge chat-origin proof', () => {
  const evidence = withoutSciForgeChatOriginProof(liveAcceptanceEvidence('CU-NEXT-07'));

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'missing-required-ref') || hasIssue(result, 'missing-required-evidence-claim'));
  assert.match(result.issues.map((issue) => issue.reason).join('\n'), /chat-origin|SciForge chat/i);
});

test('CU-NEXT task marker projector emits validator-accepted markers for CU-NEXT-01..08', () => {
  for (const taskId of Object.keys(expectedMarkerKinds) as CuNextTaskId[]) {
    const projection = projectCuNextTaskAcceptanceMarkers(taskId, projectionRefs(taskId));
    const evidence = liveAcceptanceEvidence(taskId, {
      status: projection.status,
      evidenceMarkers: projection.evidenceMarkers,
    });
    const result = validateCuNextLiveAcceptanceTaskEvidence({
      taskId,
      evidence,
      refRecords: {
        ...acceptanceSupportRefRecords(taskId),
        ...(isApprovalTask(taskId) ? approvalChainRefRecords(taskId) : {}),
        ...(taskId === 'CU-NEXT-07' ? denseGroundingRefRecords(taskId) : {}),
      },
    });

    assert.equal(result.ok, true, `${taskId}: ${result.issues.map((issue) => issue.reason).join('\n')}`);
    assert.equal(result.markerKind, expectedMarkerKinds[taskId]);
    assert.equal(result.markerFound, true);
  }
});

test('CU-NEXT task marker projector requires dedicated sidecar refs for approval, repair, and directory markers', () => {
  const taskIds: CuNextTaskId[] = ['CU-NEXT-03', 'CU-NEXT-04', 'CU-NEXT-05', 'CU-NEXT-06'];

  for (const taskId of taskIds) {
    const refs = projectionRefs(taskId);
    delete refs.approvalRequestRef;
    delete refs.guiAskUserRecordRef;
    delete refs.confirmedRequestRef;
    delete refs.riskAuditRef;
    delete refs.blockedManifestRef;
    delete refs.repairHintRef;
    delete refs.continuationRequestRef;
    delete refs.directoryListingRef;

    const projection = projectCuNextTaskAcceptanceMarkers(taskId, refs);
    const result = validateCuNextLiveAcceptanceTaskEvidence({
      taskId,
      evidence: liveAcceptanceEvidence(taskId, {
        status: projection.status,
        evidenceMarkers: projection.evidenceMarkers,
      }),
    });

    assert.equal(result.ok, false, `${taskId} should require dedicated sidecar refs`);
    assert.ok(hasIssue(result, 'invalid-task-marker'));
  }
});

test('CU-NEXT live acceptance requires exact structured taskId and mapped scenarioId', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    taskId: 'CU-NEXT-04',
    taskText: 'This text mentions CU-NEXT-07 and dense grounding, but the structured task binding is wrong.',
    scenarioId: 'CU-LONG-005',
    cuNextTask: {
      taskId: 'CU-NEXT-04',
      primaryScenarioId: 'CU-LONG-005',
      longScenarioIds: ['CU-LONG-005'],
    },
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.exactTaskId, false);
  assert.equal(result.checks.scenarioMapped, false);
  assert.ok(hasIssue(result, 'task-id-mismatch'));
  assert.ok(hasIssue(result, 'scenario-not-mapped'));
  assert.ok(hasIssue(result, 'primary-scenario-mismatch'));
  assert.ok(hasIssue(result, 'long-scenario-map-mismatch'));
});

test('CU-NEXT live acceptance rejects fixture, dry-run, shared input, shell direct, and shortcut substitutes', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    trace: {
      testActionFixtureMode: true,
      dryRun: true,
      allowSharedSystemInput: true,
      artifactCausality: {
        shellDirectArtifactWrite: true,
      },
    },
    evidenceClaims: [
      ...commonEvidenceClaims('CU-NEXT-07'),
      { id: 'shared-input', kind: 'shared-input-ack', ref: ref('CU-NEXT-07', 'shared-input.json') },
      { id: 'dom-shortcut', kind: 'dom', ref: 'document.querySelector("[aria-label=Export]")' },
    ],
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.disqualifiersClean, false);
  assert.ok(hasIssue(result, 'forbidden-fixture'));
  assert.ok(hasIssue(result, 'forbidden-dry-run'));
  assert.ok(hasIssue(result, 'forbidden-shared-input'));
  assert.ok(hasIssue(result, 'forbidden-shell-direct-artifact-write'));
  assert.ok(hasIssue(result, 'forbidden-shortcut-substitute'));
});

test('CU-NEXT live acceptance allows DOM/AX/Playwright only as refs-first observation hints', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    evidenceClaims: [
      ...commonEvidenceClaims('CU-NEXT-07'),
      {
        id: 'dom-visible-hint',
        kind: 'dom',
        observationUse: 'observe-before-mutate-hint',
        refs: [ref('CU-NEXT-07', 'browser-visible-dom.json')],
        executorLeaseSubstitute: false,
        guiActionSubstitute: false,
        artifactCausalitySubstitute: false,
        completionEvidenceEligible: false,
      },
      {
        id: 'ax-grounding-hint',
        kind: 'accessibility',
        use: 'grounding-hint',
        refs: [ref('CU-NEXT-07', 'browser-accessibility.json')],
        completionEvidence: false,
      },
      {
        id: 'playwright-evaluate-hint',
        kind: 'playwright',
        evidenceUse: 'grounding-hint',
        refs: [ref('CU-NEXT-07', 'browser-playwright-evaluate.json')],
        completionEvidenceSubstitute: false,
      },
    ],
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, true, result.issues.map((issue) => issue.reason).join('\n'));
  assert.equal(result.checks.disqualifiersClean, true);
});

test('CU-NEXT live acceptance rejects DOM/AX claim-only hints without structured BrowserRuntime observation', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    evidenceClaims: [
      ...commonEvidenceClaims('CU-NEXT-07'),
      {
        id: 'dom-visible-claim-only',
        kind: 'dom',
        observationUse: 'observe-before-mutate-hint',
        refs: [ref('CU-NEXT-07', 'browser-visible-dom.json')],
        executorLeaseSubstitute: false,
        guiActionSubstitute: false,
        artifactCausalitySubstitute: false,
        completionEvidenceEligible: false,
      },
    ],
  });
  delete evidence.browserRuntimeDomAxObservation;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'missing-browser-runtime-observation-hint'));
});

test('CU-NEXT live acceptance rejects DOM/AX claims outside structured BrowserRuntime observation refs', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    evidenceClaims: [
      ...commonEvidenceClaims('CU-NEXT-07'),
      {
        id: 'dom-visible-other-run',
        kind: 'dom',
        observationUse: 'observe-before-mutate-hint',
        refs: [ref('CU-NEXT-07', 'unbound-dom-claim.json')],
        executorLeaseSubstitute: false,
        guiActionSubstitute: false,
        artifactCausalitySubstitute: false,
        completionEvidenceEligible: false,
      },
    ],
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'invalid-browser-runtime-observation-hint'));
});

test('CU-NEXT live acceptance rejects floating BrowserRuntime observations not bound to action refs', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  const observeBeforeMutate = evidence.observeBeforeMutate as Record<string, unknown>;
  delete observeBeforeMutate.browserRuntimeObservationRef;
  const action = (evidence.mutatingActions as Array<Record<string, unknown>>)[0];
  action.groundingRefs = [ref('CU-NEXT-07', 'grounding-diagnostics.json')];

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'invalid-browser-runtime-observation-hint'));
});

test('CU-NEXT live acceptance requires multi-screen actor cursor provenance and replay refs', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  delete evidence.virtualDisplayGroup;
  delete evidence.actorCursorProvenance;
  delete evidence.cursorEvents;
  delete evidence.mutatingActions;
  delete evidence.replayBundle;
  evidence.executorLease = {
    status: 'present',
    ref: ref('CU-NEXT-07', 'executor-lease.json'),
  };

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'missing-screen-identity'));
  assert.ok(hasIssue(result, 'missing-actor-cursor-provenance'));
  assert.ok(hasIssue(result, 'missing-executor-lease-scope'));
  assert.ok(hasIssue(result, 'missing-action-causality'));
});

test('CU-NEXT live acceptance requires read-only actor cursor events', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  evidence.cursorEvents = [
    {
      kind: 'move',
      actorId: `${runId('CU-NEXT-07')}-actor-agent`,
      cursorId: `${runId('CU-NEXT-07')}-cursor-agent`,
      screenId: `${runId('CU-NEXT-07')}-screen-main`,
      cursorEventLogRef: ref('CU-NEXT-07', 'actor-cursors.jsonl'),
      readOnlyCursorEvent: false,
      mutatingGuiAction: true,
    },
  ];

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'missing-actor-cursor-provenance'));
});

test('CU-NEXT live acceptance requires non-placeholder replay frames for every screen', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  const replay = evidence.replayBundle as Record<string, unknown>;
  replay.frames = [
    {
      screenId: `${runId('CU-NEXT-07')}-screen-main`,
      screenshotRef: ref('CU-NEXT-07', 'before.png'),
      cursorOverlayRefs: [ref('CU-NEXT-07', 'cursor-overlay-before.json')],
    },
    {
      screenId: `${runId('CU-NEXT-07')}-screen-preview`,
      placeholder: true,
      cursorOverlayRefs: [ref('CU-NEXT-07', 'cursor-overlay-preview-before.json')],
    },
  ];

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'missing-action-causality'));
  assert.ok(hasIssue(result, 'forbidden-placeholder-viewer'));
});

test('CU-NEXT live acceptance requires strict BrowserRuntime DOM/AX hint boundary flags', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  const observation = evidence.browserRuntimeDomAxObservation as Record<string, unknown>;
  delete observation.refsFirst;
  delete observation.currentBundleOnly;
  delete observation.trust;
  delete observation.executorLeaseSubstitute;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'invalid-browser-runtime-observation-hint'));
});

test('CU-NEXT live acceptance fail-closes without user control, observe-before-mutate, sidecar isolation, and product path refs', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  delete evidence.userControlPlane;
  delete evidence.observeBeforeMutate;
  delete evidence.platformSidecarIsolationReport;
  evidence.productPathClassification = {
    tier: 'package-diagnostic',
    hops: ['package-local'],
    diagnosticOnly: true,
    packageDiagnosticOnly: true,
  };
  for (const action of evidence.mutatingActions as Array<Record<string, unknown>>) {
    delete action.currentAppStateRef;
    delete action.currentScreenshotRef;
    delete action.stateSnapshotRef;
    delete action.freshnessCheckRef;
  }

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'missing-user-control-ref'));
  assert.ok(hasIssue(result, 'missing-observe-before-mutate-ref'));
  assert.ok(hasIssue(result, 'missing-platform-sidecar-isolation'));
  assert.ok(hasIssue(result, 'invalid-product-path-classification'));
});

test('CU-NEXT live acceptance requires freshnessCheckRef to resolve in refRecords', () => {
  const taskId: CuNextTaskId = 'CU-NEXT-07';
  const evidence = liveAcceptanceEvidence(taskId);
  const refRecords = denseGroundingRefRecords(taskId);
  delete refRecords[ref(taskId, 'freshness-check.json')];

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId,
    evidence,
    refRecords,
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'invalid-observe-before-mutate-freshness'));
  assert.match(result.issues.map((issue) => issue.reason).join('\n'), /freshnessCheckRef must resolve/);
});

test('CU-NEXT live acceptance rejects stale or expired freshnessCheckRef records', () => {
  const taskId: CuNextTaskId = 'CU-NEXT-07';
  for (const [name, freshnessRecord, expected] of [
    ['stale', {
      schemaVersion: 'sciforge.computer-use.freshness-check.v1',
      status: 'stale',
      observedAt: '2026-05-28T00:00:00.000Z',
      checkedAt: '2026-05-28T00:00:00.000Z',
      maxAgeMs: 30_000,
      reason: 'visible state was invalidated by a later executor event',
    }, /freshness status is stale|visible state was invalidated/],
    ['expired', {
      schemaVersion: 'sciforge.computer-use.freshness-check.v1',
      status: 'current',
      observedAt: '2026-05-28T00:00:00.000Z',
      checkedAt: '2026-05-28T00:00:11.000Z',
      expiresAt: '2026-05-28T00:00:10.000Z',
      maxAgeMs: 30_000,
    }, /expired/],
  ] as const) {
    const refRecords = {
      ...denseGroundingRefRecords(taskId),
      [ref(taskId, 'freshness-check.json')]: freshnessRecord,
    };

    const result = validateCuNextLiveAcceptanceTaskEvidence({
      taskId,
      evidence: liveAcceptanceEvidence(taskId),
      refRecords,
    });

    assert.equal(result.ok, false, name);
    assert.ok(hasIssue(result, 'invalid-observe-before-mutate-freshness'), name);
    assert.match(result.issues.map((issue) => issue.reason).join('\n'), expected);
  }
});

test('CU-NEXT live acceptance caps freshnessCheckRef maxAgeMs to the visual evidence default', () => {
  const taskId: CuNextTaskId = 'CU-NEXT-07';
  const refRecords = {
    ...denseGroundingRefRecords(taskId),
    [ref(taskId, 'freshness-check.json')]: {
      schemaVersion: 'sciforge.computer-use.freshness-check.v1',
      status: 'current',
      observedAt: '2026-05-28T00:00:00.000Z',
      checkedAt: '2026-05-28T00:01:00.000Z',
      maxAgeMs: 300_000,
    },
  };

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId,
    evidence: liveAcceptanceEvidence(taskId),
    refRecords,
  });

  assert.equal(result.ok, false);
  assert.ok(hasIssue(result, 'invalid-observe-before-mutate-freshness'));
  assert.match(result.issues.map((issue) => issue.reason).join('\n'), /older than 30000ms/);
});

test('CU-NEXT live acceptance requires each action to trace InputIntent through adapter executor frames verifier and artifact', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  const action = (evidence.mutatingActions as Array<Record<string, unknown>>)[0];
  delete action.inputIntentRef;
  delete action.providerAdapterRef;
  delete action.artifactRefs;
  delete evidence.finalArtifactRef;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'missing-evidence-ledger-trace'));
  assert.match(result.issues.map((issue) => issue.reason).join('\n'), /InputIntent|providerAdapterRef|artifact refs/i);
});

test('CU-NEXT live acceptance requires gui.present to prove the current session is presentable', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  evidence.guiPresent = {
    status: 'present',
    recordRef: ref('CU-NEXT-07', 'gui-present.json'),
    payloadRef: ref('CU-NEXT-07', 'gui-present-payload.json'),
    displayedRefs: [ref('CU-NEXT-07', finalArtifactName('CU-NEXT-07'))],
    sessionRefs: [ref('CU-NEXT-04', 'computer-use-session.json')],
  };

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.ok(hasIssue(result, 'missing-gui-present-current-session'));
});

test('CU-NEXT live acceptance rejects shell-only stale fixture-pass artifacts and cross-bundle action refs', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    artifactValidation: {
      shellOnly: true,
      staleFile: true,
      fixturePass: true,
    },
  });
  const action = (evidence.mutatingActions as Array<Record<string, unknown>>)[0];
  action.inputIntentRef = ref('CU-NEXT-04', 'input-intent-click.json');

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.disqualifiersClean, false);
  assert.ok(hasIssue(result, 'forbidden-shell-stale-fixture-artifact'));
  assert.ok(hasIssue(result, 'forbidden-cross-bundle-ref'));
});

test('CU-NEXT live acceptance rejects global coordinates placeholder-only viewer stale and cross-bundle evidence', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07');
  evidence.staleEvidenceUsed = true;
  const displayGroup = evidence.virtualDisplayGroup as Record<string, unknown>;
  displayGroup.screens = [
    {
      screenId: `${runId('CU-NEXT-07')}-screen-main`,
      ref: '../previous-round/virtual-screen-main.json',
    },
  ];
  const action = ((evidence.mutatingActions as Array<Record<string, unknown>>)[0]);
  action.target = { coordinateSpace: 'global', x: 10, y: 20 };
  evidence.replayBundle = {
    frames: [{ screenId: `${runId('CU-NEXT-07')}-screen-main`, placeholder: true }],
    cursorOverlayRefs: [ref('CU-NEXT-07', 'cursor-overlay.json')],
    leaseOwnerRefs: [ref('CU-NEXT-07', 'executor-lease.json')],
    beforeEvidenceRefs: [ref('CU-NEXT-07', 'before.png')],
    afterEvidenceRefs: [ref('CU-NEXT-07', 'after.png')],
  };

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.disqualifiersClean, false);
  assert.ok(hasIssue(result, 'forbidden-bare-global-coordinates'));
  assert.ok(hasIssue(result, 'forbidden-placeholder-viewer'));
  assert.ok(hasIssue(result, 'forbidden-stale-evidence'));
  assert.ok(hasIssue(result, 'forbidden-cross-bundle-ref'));
});

test('CU-NEXT live acceptance rejects synthetic fixture origin strings', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    provenance: {
      origin: 'synthetic-fixture',
    },
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
    refRecords: denseGroundingRefRecords('CU-NEXT-07'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.disqualifiersClean, false);
  assert.ok(hasIssue(result, 'forbidden-fixture'));
});

test('CU-NEXT live acceptance requires structured task markers, not marker words in taskText', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    taskText: 'dense grounding coarse fine focus crop rejected excluded targets are all mentioned here',
  });
  delete evidence.evidenceMarkers;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.markerFound, false);
  assert.equal(result.checks.taskMarker, false);
  assert.ok(hasIssue(result, 'missing-task-marker'));
});

test('CU-NEXT live acceptance only accepts task markers from top-level evidenceMarkers', () => {
  const denseMarker = taskMarker('CU-NEXT-07');
  const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
    kind: 'dense-grounding',
    denseMarker,
    nested: {
      marker: {
        type: 'dense-grounding',
        ...denseMarker,
      },
    },
  });
  delete evidence.evidenceMarkers;

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.markerFound, false);
  assert.equal(result.checks.taskMarker, false);
  assert.ok(hasIssue(result, 'missing-task-marker'));
});

test('CU-NEXT-07 dense grounding requires dedicated rejected target evidence', () => {
  const verifierFallback = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence: liveAcceptanceEvidence('CU-NEXT-07', {
      evidenceMarkers: [{
        ...taskMarker('CU-NEXT-07'),
        rejectedTargetRefs: [ref('CU-NEXT-07', 'cu-l3-independent-input-verifier.json')],
      }],
    }),
    refRecords: {
      [ref('CU-NEXT-07', 'cu-l3-independent-input-verifier.json')]: {
        schemaVersion: 'sciforge.computer-use.l3-independent-input-verifier.v1',
        status: 'passed',
      },
    },
  });
  assert.equal(verifierFallback.ok, false);
  assert.match(verifierFallback.issues.map((issue) => issue.reason).join('\n'), /dedicated rejected-target evidence/);

  const missingRejectedTargets = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-07',
    evidence: liveAcceptanceEvidence('CU-NEXT-07'),
    refRecords: denseGroundingRefRecords('CU-NEXT-07', { rejectedTargets: [] }),
  });
  assert.equal(missingRejectedTargets.ok, false);
  assert.match(missingRejectedTargets.issues.map((issue) => issue.reason).join('\n'), /non-empty rejectedTargets/);
});

test('CU-NEXT live acceptance rejects marker refs that are not evidence-bundle-local file refs', () => {
  const invalidRefs = ['not-a-file', 'https://example.test/evidence.json', 'dom:#export-button'];

  for (const invalidRef of invalidRefs) {
    const evidence = liveAcceptanceEvidence('CU-NEXT-07', {
      evidenceMarkers: [
        {
          ...taskMarker('CU-NEXT-07'),
          coarseWindowScreenshotRef: invalidRef,
        },
      ],
    });

    const result = validateCuNextLiveAcceptanceTaskEvidence({
      taskId: 'CU-NEXT-07',
      evidence,
    });

    assert.equal(result.ok, false, invalidRef);
    assert.equal(result.markerFound, true, invalidRef);
    assert.equal(result.checks.taskMarker, false, invalidRef);
    assert.ok(hasIssue(result, 'invalid-task-marker'), invalidRef);
    assert.match(result.issues.map((issue) => issue.reason).join('\n'), /evidence-bundle-local/, invalidRef);
  }
});

test('CU-NEXT-03 live acceptance requires top-level status=needs-confirmation', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-03', {
    status: 'multi-app-workflow-passed',
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-03',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.checks.requiredRefs, false);
  assert.equal(result.markerFound, true);
  assert.ok(hasIssue(result, 'invalid-live-acceptance-status'));
  assert.match(result.issues.map((issue) => issue.reason).join('\n'), /status=needs-confirmation/);
});

test('CU-NEXT-03 live acceptance requires validated needs-confirmation sidecars', () => {
  const noRecords = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-03',
    evidence: liveAcceptanceEvidence('CU-NEXT-03'),
  });
  assert.equal(noRecords.ok, false);
  assert.ok(hasIssue(noRecords, 'invalid-task-marker'));
  assert.match(noRecords.issues.map((issue) => issue.reason).join('\n'), /sidecar content|risk-audit/i);

  const invalidRiskAudit = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-03',
    evidence: liveAcceptanceEvidence('CU-NEXT-03'),
    refRecords: approvalChainRefRecords('CU-NEXT-03', { riskAuditStatus: 'confirmed' }),
  });
  assert.equal(invalidRiskAudit.ok, false);
  assert.ok(hasIssue(invalidRiskAudit, 'invalid-task-marker'));
  assert.match(invalidRiskAudit.issues.map((issue) => issue.reason).join('\n'), /status=needs-confirmation/);

  const mixedConfirmedPhase = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-03',
    evidence: liveAcceptanceEvidence('CU-NEXT-03', {
      evidenceMarkers: [{
        ...taskMarker('CU-NEXT-03'),
        confirmedRequestRef: ref('CU-NEXT-03', 'confirmed-request.json'),
      }],
    }),
    refRecords: approvalChainRefRecords('CU-NEXT-03'),
  });
  assert.equal(mixedConfirmedPhase.ok, false);
  assert.ok(hasIssue(mixedConfirmedPhase, 'invalid-task-marker'));
  assert.match(mixedConfirmedPhase.issues.map((issue) => issue.reason).join('\n'), /must not include confirmed-request/);
});

test('CU-NEXT approval sidecar refs are extracted from hyphenated needs-confirmation markers', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-03');

	  assert.deepEqual(approvalChainSidecarRefsFromEvidence(evidence), {
	    approvalRequestRef: ref('CU-NEXT-03', 'approval-request.json'),
	    guiAskUserRecordRef: ref('CU-NEXT-03', 'gui-ask-user.json'),
	    confirmedRequestRef: undefined,
	    riskAuditRef: ref('CU-NEXT-03', 'risk-audit.json'),
	    sourceApprovalRequestRef: undefined,
	    sourceGuiAskUserRecordRef: undefined,
	    sourceRiskAuditRef: undefined,
	    approvalDecisionRef: undefined,
	  });
});

test('CU-NEXT approval task requires an approvalRef marker, not only needs-confirmation refs', () => {
  const evidence = liveAcceptanceEvidence('CU-NEXT-06', {
    evidenceMarkers: [
      {
        kind: 'approval-ref',
        approvalRequestRef: ref('CU-NEXT-06', 'approval-request.json'),
        guiAskUserRecordRef: ref('CU-NEXT-06', 'gui-ask-user.json'),
        confirmedRequestRef: ref('CU-NEXT-06', 'confirmed-request.json'),
        deniedExecuted: false,
      },
    ],
  });

  const result = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence,
  });

  assert.equal(result.ok, false);
  assert.equal(result.markerFound, true);
  assert.ok(hasIssue(result, 'invalid-task-marker'));
  assert.match(result.issues.map((issue) => issue.reason).join('\n'), /approvalRef/);
});

test('CU-NEXT approval task rejects empty approval token and alias-only approval refs', () => {
  const emptyApprovalRefEvidence = liveAcceptanceEvidence('CU-NEXT-06', {
    evidenceMarkers: [
      {
        ...taskMarker('CU-NEXT-06'),
        approvalRef: 'approval:',
      },
    ],
  });
  const emptyApprovalRefResult = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence: emptyApprovalRefEvidence,
  });

  assert.equal(emptyApprovalRefResult.ok, false);
  assert.equal(emptyApprovalRefResult.markerFound, true);
  assert.ok(hasIssue(emptyApprovalRefResult, 'invalid-task-marker'));

  const aliasOnlyMarker = taskMarker('CU-NEXT-06');
  aliasOnlyMarker.humanApprovalRef = `approval:${runId('CU-NEXT-06')}:human`;
  aliasOnlyMarker.confirmedApprovalRef = `approval:${runId('CU-NEXT-06')}:confirmed`;
  delete aliasOnlyMarker.approvalRef;
  const aliasOnlyEvidence = liveAcceptanceEvidence('CU-NEXT-06', {
    evidenceMarkers: [aliasOnlyMarker],
  });
  const aliasOnlyResult = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence: aliasOnlyEvidence,
  });

  assert.equal(aliasOnlyResult.ok, false);
  assert.equal(aliasOnlyResult.markerFound, true);
  assert.ok(hasIssue(aliasOnlyResult, 'invalid-task-marker'));
  assert.match(aliasOnlyResult.issues.map((issue) => issue.reason).join('\n'), /canonical approvalRef/);
});

test('CU-NEXT approval task requires validated sidecar records and rejects session-derived approvalRef', () => {
  const noRecords = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence: liveAcceptanceEvidence('CU-NEXT-06'),
  });
  assert.equal(noRecords.ok, false);
  assert.ok(hasIssue(noRecords, 'invalid-task-marker'));
  assert.match(noRecords.issues.map((issue) => issue.reason).join('\n'), /sidecar content|approval-request/i);

  const sessionDerivedRef = `approval:${sessionRef('CU-NEXT-06')}:confirmed`;
  const marker = {
    ...taskMarker('CU-NEXT-06'),
    approvalRef: sessionDerivedRef,
  };
  const sessionDerived = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence: liveAcceptanceEvidence('CU-NEXT-06', { evidenceMarkers: [marker] }),
    refRecords: approvalChainRefRecords('CU-NEXT-06', {
      approvalRef: sessionDerivedRef,
    }),
  });
  assert.equal(sessionDerived.ok, false);
  assert.ok(hasIssue(sessionDerived, 'invalid-task-marker'));
  assert.match(sessionDerived.issues.map((issue) => issue.reason).join('\n'), /session, trace, or request-derived/);

  const selfContainedApproval = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence: liveAcceptanceEvidence('CU-NEXT-06'),
    refRecords: approvalChainRefRecords('CU-NEXT-06', {
      approvalBoundarySource: 'confirmed-retry-without-prior-request',
    }),
  });
  assert.equal(selfContainedApproval.ok, false);
  assert.ok(hasIssue(selfContainedApproval, 'invalid-task-marker'));
  assert.match(selfContainedApproval.issues.map((issue) => issue.reason).join('\n'), /prior fail-closed approval request/);

  const rewrittenSource = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: 'CU-NEXT-06',
    evidence: liveAcceptanceEvidence('CU-NEXT-06'),
    refRecords: approvalChainRefRecords('CU-NEXT-06', {
      sourceApprovalRef: `approval:${runId('CU-NEXT-06')}:rewritten-source`,
    }),
  });
  assert.equal(rewrittenSource.ok, false);
  assert.ok(hasIssue(rewrittenSource, 'invalid-task-marker'));
  assert.match(rewrittenSource.issues.map((issue) => issue.reason).join('\n'), /source sidecar identity cannot be rewritten|confirmed retry must use the original prior approval identity/);
});

function liveAcceptanceInput(taskId: CuNextTaskId) {
  return {
    taskId,
    evidence: liveAcceptanceEvidence(taskId),
    refRecords: {
      ...acceptanceSupportRefRecords(taskId),
      ...(isApprovalTask(taskId) ? approvalChainRefRecords(taskId) : {}),
      ...(taskId === 'CU-NEXT-07' ? denseGroundingRefRecords(taskId) : {}),
    },
  };
}

function liveAcceptanceEvidence(
  taskId: CuNextTaskId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const mapping = mappingFor(taskId);
  const finalArtifactRef = ref(taskId, finalArtifactName(taskId));
  const finalArtifactValidationRef = artifactValidationRef(taskId);
  const sourceRefs = artifactSourceRefs(taskId);
  const primaryMutatingAction = {
    actionKind: 'click',
    screenId: `${runId(taskId)}-screen-main`,
    windowId: `${runId(taskId)}-window-main`,
    actorId: `${runId(taskId)}-actor-agent`,
    cursorId: `${runId(taskId)}-cursor-agent`,
    leaseId: `${runId(taskId)}-lease-window-main`,
    leaseScope: {
      kind: 'window-local',
      screenId: `${runId(taskId)}-screen-main`,
      windowId: `${runId(taskId)}-window-main`,
    },
    target: {
      scope: 'window',
      screenId: `${runId(taskId)}-screen-main`,
      windowId: `${runId(taskId)}-window-main`,
      bounds: { x: 10, y: 12, width: 80, height: 28 },
    },
    beforeEvidenceRefs: [ref(taskId, 'before.png')],
    afterEvidenceRefs: [ref(taskId, 'after.png')],
    inputIntentRef: ref(taskId, 'input-intent-click.json'),
    providerAdapterRef: ref(taskId, 'sidecar-executor-adapter.json'),
    currentAppStateRef: ref(taskId, 'current-app-state.json'),
    currentScreenshotRef: ref(taskId, 'before.png'),
    stateSnapshotRef: ref(taskId, 'state-snapshot.json'),
    freshnessCheckRef: ref(taskId, 'freshness-check.json'),
    groundingRefs: [ref(taskId, 'grounding-diagnostics.json'), ref(taskId, 'browser-grounding-hints.json')],
    executorEventRef: ref(taskId, 'executor-event.json'),
    verificationRefs: [ref(taskId, 'verifier-verdict.json')],
    artifactRefs: [finalArtifactRef],
  };
  const evidence: Record<string, unknown> = {
    schemaVersion: 'sciforge.computer-use.user-acceptance-manifest.v1',
    runId: runId(taskId),
    taskId,
    scenarioId: mapping.primaryScenarioId,
    cuNextTask: {
      taskId,
      primaryScenarioId: mapping.primaryScenarioId,
      longScenarioIds: mapping.longScenarioIds,
    },
    createdAt: '2026-05-28T00:00:00.000Z',
    status: taskId === 'CU-NEXT-03' ? 'needs-confirmation' : 'multi-app-workflow-passed',
    taskText: `${taskId} ${mapping.slug}`,
    level: 'L3',
    appWorkflow: {
      kind: 'multi-app-workflow',
      apps: ['Browser', 'LibreOffice Writer', 'Finder'],
      windowSwitchTraceRefs: [ref(taskId, 'window-switch-trace.json')],
    },
    productPathClassification: {
      schemaVersion: 'sciforge.computer-use.product-path-classification.v1',
      tier: 'product-smoke',
      entrypoint: 'codex-app-server/native-plugin',
      hops: ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use', 'native-multi-screen-sidecar'],
      appServerRunRef: ref(taskId, 'codex-app-server-run.json'),
      nativePluginInvocationRef: ref(taskId, 'native-plugin-invocation.json'),
      sciforgeComputerUseRunTaskRef: ref(taskId, 'tui-host-run-task-chain.json'),
      platformSidecarIsolationReportRef: ref(taskId, 'platform-sidecar-isolation-report.json'),
      currentBundleRef: `.sciforge/vision-runs/${runId(taskId)}`,
      currentBundleOnly: true,
      diagnosticOnly: false,
      packageDiagnosticOnly: false,
    },
    userControlPlane: {
      schemaVersion: 'sciforge.computer-use.user-control-plane.v1',
      status: 'present',
      sessionPermissionRef: ref(taskId, 'session-permission.json'),
      allowedAppRefs: [ref(taskId, 'allowed-apps.json')],
      allowedWindowRefs: [ref(taskId, 'allowed-windows.json')],
      forbiddenAppRefs: [ref(taskId, 'forbidden-apps.json')],
      inputModalityPolicyRef: ref(taskId, 'input-modality-policy.json'),
      riskPreviewRef: ref(taskId, 'risk-preview.json'),
      dataVisibilityRef: ref(taskId, 'data-visibility.json'),
      stopRef: ref(taskId, 'stop-cancel-lease.json'),
      cancelLeaseRef: ref(taskId, 'stop-cancel-lease.json'),
      approvalMode: taskId === 'CU-NEXT-03' || taskId === 'CU-NEXT-06'
        ? 'required-before-high-risk-action'
        : 'bounded-low-risk',
    },
    platformSidecarIsolationReport: {
      schemaVersion: 'sciforge.computer-use.platform-sidecar-isolation-report.v1',
      status: 'passed',
      backendKind: 'native-multi-screen-sidecar',
      sidecarKind: 'native-multi-screen-sidecar',
      reportRef: ref(taskId, 'platform-sidecar-isolation-report.json'),
      captureRef: ref(taskId, 'sidecar-capture.json'),
      stateRef: ref(taskId, 'sidecar-state.json'),
      preflightRef: ref(taskId, 'sidecar-preflight.json'),
      executorAdapterRef: ref(taskId, 'sidecar-executor-adapter.json'),
      isolationFlags: {
        sharedSystemInputUsed: false,
        systemPointerMoved: false,
        systemKeyboardEventsSent: false,
        sidecarDoesPlanning: false,
        sidecarDoesCompletion: false,
      },
    },
    virtualDisplayGroup: {
      displayGroupId: `${runId(taskId)}-display-group`,
      ref: ref(taskId, 'virtual-display-group.json'),
      screens: [
        {
          screenId: `${runId(taskId)}-screen-main`,
          ref: ref(taskId, 'virtual-screen-main.json'),
          geometry: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
        },
        {
          screenId: `${runId(taskId)}-screen-preview`,
          ref: ref(taskId, 'virtual-screen-preview.json'),
          geometry: { x: 1280, y: 0, width: 1024, height: 720, scale: 1 },
        },
      ],
    },
    actorCursorProvenance: [
      {
        actorId: `${runId(taskId)}-actor-agent`,
        cursorId: `${runId(taskId)}-cursor-agent`,
        screenId: `${runId(taskId)}-screen-main`,
        actorCursorLogRef: ref(taskId, 'actor-cursors.jsonl'),
      },
      {
        actorId: `${runId(taskId)}-actor-writer`,
        cursorId: `${runId(taskId)}-cursor-writer`,
        screenId: `${runId(taskId)}-screen-main`,
        actorCursorLogRef: ref(taskId, 'actor-cursors.jsonl'),
      },
      {
        actorId: `${runId(taskId)}-actor-preview`,
        cursorId: `${runId(taskId)}-cursor-preview`,
        screenId: `${runId(taskId)}-screen-preview`,
        actorCursorLogRef: ref(taskId, 'actor-cursors.jsonl'),
      },
    ],
    cursorEvents: [
      {
        kind: 'move',
        actorId: `${runId(taskId)}-actor-agent`,
        cursorId: `${runId(taskId)}-cursor-agent`,
        screenId: `${runId(taskId)}-screen-main`,
        cursorEventLogRef: ref(taskId, 'actor-cursors.jsonl'),
        readOnlyCursorEvent: true,
        mutatingGuiAction: false,
      },
      {
        kind: 'point',
        actorId: `${runId(taskId)}-actor-writer`,
        cursorId: `${runId(taskId)}-cursor-writer`,
        screenId: `${runId(taskId)}-screen-main`,
        cursorEventLogRef: ref(taskId, 'actor-cursors.jsonl'),
        readOnlyCursorEvent: true,
        mutatingGuiAction: false,
      },
      {
        kind: 'annotate',
        actorId: `${runId(taskId)}-actor-preview`,
        cursorId: `${runId(taskId)}-cursor-preview`,
        screenId: `${runId(taskId)}-screen-preview`,
        cursorEventLogRef: ref(taskId, 'actor-cursors.jsonl'),
        readOnlyCursorEvent: true,
        mutatingGuiAction: false,
      },
    ],
    antiShortcutGuard: {
      status: 'passed',
      rejectedClaims: [],
    },
    tuiHostChain: [
      {
        id: 'chat-origin',
        kind: 'sciForge-chat-origin',
        status: 'present',
        requestRef: ref(taskId, 'computer-use-request.json'),
        origin: sciForgeChatOrigin(),
      },
      {
        id: 'tui-host-runTask',
        kind: 'tui-host-runTask',
        status: 'present',
        requestRef: ref(taskId, 'computer-use-request.json'),
        hostPortsRef: ref(taskId, 'host-ports.json'),
      },
      {
        id: 'computer-use-action-provider',
        kind: 'computer-use-action-provider',
        status: 'present',
        toolPayloadRef: ref(taskId, 'tool-payload.json'),
      },
      {
        id: 'gui-present',
        kind: 'gui.present',
        status: 'present',
        recordRef: ref(taskId, 'gui-present.json'),
      },
    ],
    screenshotRefs: {
      before: [ref(taskId, 'before.png')],
      after: [ref(taskId, 'after.png')],
    },
    focusCropRefs: [ref(taskId, 'focus-crop.png')],
    groundingDiagnosticsRefs: [ref(taskId, 'grounding-diagnostics.json')],
    executorLease: {
      status: 'present',
      ref: ref(taskId, 'executor-lease.json'),
      owner: 'sciforge-independent-input-adapter',
      screenId: `${runId(taskId)}-screen-main`,
      windowId: `${runId(taskId)}-window-main`,
      actorId: `${runId(taskId)}-actor-agent`,
      cursorId: `${runId(taskId)}-cursor-agent`,
      leaseScope: {
        kind: 'window-local',
        screenId: `${runId(taskId)}-screen-main`,
        windowId: `${runId(taskId)}-window-main`,
      },
    },
    observeBeforeMutate: {
      schemaVersion: 'sciforge.computer-use.observe-before-mutate.v1',
      status: 'passed',
      currentAppStateRef: ref(taskId, 'current-app-state.json'),
      currentScreenshotRef: ref(taskId, 'before.png'),
      stateSnapshotRef: ref(taskId, 'state-snapshot.json'),
      freshnessCheckRef: ref(taskId, 'freshness-check.json'),
      browserRuntimeObservationRef: ref(taskId, 'browser-dom-ax-observation.json'),
      browserRuntimeObservationUse: 'observe-before-mutate-hint',
    },
    browserRuntimeDomAxObservation: {
      schemaVersion: 'sciforge.computer-use.browser-runtime-dom-ax-observation.v1',
      trust: 'untrusted-page-observation',
      refsFirst: true,
      currentBundleOnly: true,
      screenId: `${runId(taskId)}-screen-main`,
      windowId: `${runId(taskId)}-window-main`,
      observationRef: ref(taskId, 'browser-dom-ax-observation.json'),
      visibleDomRef: ref(taskId, 'browser-visible-dom.json'),
      accessibilitySnapshotRef: ref(taskId, 'browser-accessibility.json'),
      playwrightEvaluateRef: ref(taskId, 'browser-playwright-evaluate.json'),
      pageQueryRef: ref(taskId, 'browser-page-query.json'),
      stableRefs: [ref(taskId, 'browser-stable-refs.json')],
      groundingHintRefs: [ref(taskId, 'browser-grounding-hints.json')],
      observationUse: 'observe-before-mutate-hint',
      executorLeaseSubstitute: false,
      guiActionSubstitute: false,
      artifactCausalitySubstitute: false,
      completionEvidenceEligible: false,
      userLevelCompletionSubstitute: false,
    },
    actionProposals: [
      {
        proposalId: `${runId(taskId)}-proposal-main-agent`,
        proposalRef: ref(taskId, 'proposal-main-agent.json'),
        actorId: `${runId(taskId)}-actor-agent`,
        cursorId: `${runId(taskId)}-cursor-agent`,
        leaseScope: {
          kind: 'window-local',
          screenId: `${runId(taskId)}-screen-main`,
          windowId: `${runId(taskId)}-window-main`,
        },
      },
      {
        proposalId: `${runId(taskId)}-proposal-main-writer`,
        proposalRef: ref(taskId, 'proposal-main-writer.json'),
        actorId: `${runId(taskId)}-actor-writer`,
        cursorId: `${runId(taskId)}-cursor-writer`,
        leaseScope: {
          kind: 'window-local',
          screenId: `${runId(taskId)}-screen-main`,
          windowId: `${runId(taskId)}-window-writer`,
        },
        decisionStatus: 'queued',
      },
      {
        proposalId: `${runId(taskId)}-proposal-preview-refresh`,
        proposalRef: ref(taskId, 'proposal-preview-refresh.json'),
        actorId: `${runId(taskId)}-actor-preview`,
        cursorId: `${runId(taskId)}-cursor-preview`,
        leaseScope: {
          kind: 'screen-global',
          screenId: `${runId(taskId)}-screen-preview`,
        },
      },
    ],
    executorQueue: [
      {
        queueId: `${runId(taskId)}-window-local-queue`,
        screenId: `${runId(taskId)}-screen-main`,
        queueKind: 'window-local',
        schedulerPolicy: 'native-screen-serial',
        leaseOwnerRefs: [ref(taskId, 'executor-lease.json')],
      },
      {
        queueId: `${runId(taskId)}-screen-global-queue`,
        screenId: `${runId(taskId)}-screen-preview`,
        queueKind: 'screen-global',
        schedulerPolicy: 'native-screen-serial',
        leaseOwnerRefs: [ref(taskId, 'screen-global-lease.json')],
      },
    ],
    mutatingActions: [primaryMutatingAction],
    actionLedgerRef: ref(taskId, 'evidence-ledger.json'),
    evidenceLedgerActions: [primaryMutatingAction],
    evidenceLedger: {
      ref: ref(taskId, 'evidence-ledger.json'),
      actionLedgerRef: ref(taskId, 'evidence-ledger.json'),
      actions: [primaryMutatingAction],
    },
    evidenceIndexRef: ref(taskId, 'evidence-index.json'),
    evidenceIndex: {
      ref: ref(taskId, 'evidence-index.json'),
      refs: [
        ref(taskId, 'evidence-ledger.json'),
        ref(taskId, 'before.png'),
        ref(taskId, 'after.png'),
        ref(taskId, 'input-intent-click.json'),
        ref(taskId, 'sidecar-executor-adapter.json'),
        ref(taskId, 'executor-event.json'),
        ref(taskId, 'verifier-verdict.json'),
        finalArtifactRef,
        finalArtifactValidationRef,
      ],
    },
    replayBundle: {
      ref: ref(taskId, 'replay-bundle.json'),
      frames: [
        {
          screenId: `${runId(taskId)}-screen-main`,
          screenshotRef: ref(taskId, 'before.png'),
          cursorOverlayRefs: [ref(taskId, 'cursor-overlay-before.json')],
          sourceEvidenceRefs: [ref(taskId, 'before.png')],
        },
        {
          screenId: `${runId(taskId)}-screen-preview`,
          screenshotRef: ref(taskId, 'preview-before.png'),
          cursorOverlayRefs: [ref(taskId, 'cursor-overlay-preview-before.json')],
          sourceEvidenceRefs: [ref(taskId, 'preview-before.png')],
        },
        {
          screenId: `${runId(taskId)}-screen-main`,
          screenshotRef: ref(taskId, 'after.png'),
          cursorOverlayRefs: [ref(taskId, 'cursor-overlay-after.json')],
          sourceEvidenceRefs: [ref(taskId, 'after.png')],
        },
        {
          screenId: `${runId(taskId)}-screen-preview`,
          screenshotRef: ref(taskId, 'preview-after.png'),
          cursorOverlayRefs: [ref(taskId, 'cursor-overlay-preview-after.json')],
          sourceEvidenceRefs: [ref(taskId, 'preview-after.png')],
        },
      ],
      cursorOverlayRefs: [
        ref(taskId, 'cursor-overlay-before.json'),
        ref(taskId, 'cursor-overlay-preview-before.json'),
        ref(taskId, 'cursor-overlay-after.json'),
        ref(taskId, 'cursor-overlay-preview-after.json'),
      ],
      leaseOwnerRefs: [ref(taskId, 'executor-lease.json'), ref(taskId, 'screen-global-lease.json')],
      beforeEvidenceRefs: [ref(taskId, 'before.png'), ref(taskId, 'preview-before.png')],
      afterEvidenceRefs: [ref(taskId, 'after.png'), ref(taskId, 'preview-after.png')],
    },
    finalArtifactRef,
    artifactValidationRef: finalArtifactValidationRef,
    taskFinalArtifactRefs: [finalArtifactRef],
    sourceRefs,
    artifactCausality: {
      savedByActionIndex: 0,
      savedByActionRef: ref(taskId, 'executor-event.json'),
      finalArtifactRef,
      artifactValidationRef: finalArtifactValidationRef,
      currentRunCausality: true,
      shellDirectArtifactWrite: false,
    },
    finalVisibleScreenshotRef: ref(taskId, 'final-visible.png'),
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: ref(taskId, 'verifier-verdict.json'),
      artifactValidationRef: finalArtifactValidationRef,
      contentRefs: [finalArtifactRef],
      checkedRefs: [finalArtifactRef],
      sourceRefs,
      savedByActionIndex: 0,
      savedByActionRef: ref(taskId, 'executor-event.json'),
    },
    guiPresent: {
      status: 'present',
      recordRef: ref(taskId, 'gui-present.json'),
      payloadRef: ref(taskId, 'gui-present-payload.json'),
      displayedRefs: [finalArtifactRef, ref(taskId, 'after.png'), ref(taskId, 'replay-bundle.json')],
      sessionRefs: [sessionRef(taskId)],
    },
    evidenceClaims: commonEvidenceClaims(taskId),
    evidenceMarkers: [taskMarker(taskId)],
  };
  return deepMerge(evidence, overrides);
}

function taskMarker(taskId: CuNextTaskId): Record<string, unknown> {
  switch (taskId) {
    case 'CU-NEXT-01':
      return {
        kind: 'briefing-deck',
        deckRef: ref(taskId, 'literature-briefing-deck.pptx'),
        sourceRefs: [ref(taskId, 'literature-refs.json')],
        outlineRef: ref(taskId, 'deck-outline.json'),
        slideCount: 8,
      };
    case 'CU-NEXT-02':
      return {
        kind: 'chart-report',
        reportRef: ref(taskId, 'chart-report.odt'),
        dataRefs: [ref(taskId, 'source-table.csv')],
        chartRefs: [ref(taskId, 'chart.png')],
      };
    case 'CU-NEXT-03':
      return {
        kind: 'needs-confirmation',
        status: 'needs-confirmation',
        highRiskAction: 'type_text',
        approvalRequestRef: ref(taskId, 'approval-request.json'),
        guiAskUserRecordRef: ref(taskId, 'gui-ask-user.json'),
        riskAuditRef: ref(taskId, 'risk-audit.json'),
        deniedExecuted: false,
      };
    case 'CU-NEXT-04':
      return {
        kind: 'file-index',
        indexRef: ref(taskId, 'file-index.md'),
        directoryListingRefs: [ref(taskId, 'directory-listing.json')],
        previewRef: ref(taskId, 'index-preview.png'),
      };
    case 'CU-NEXT-05':
      return {
        kind: 'repair-continuity',
        blockedManifestRef: ref(taskId, 'blocked-manifest.json'),
        repairHintRef: ref(taskId, 'repair-hint.json'),
        continuationRequestRef: ref(taskId, 'continuation-request.json'),
        traceSessionRef: sessionRef(taskId),
      };
    case 'CU-NEXT-06':
      return {
        kind: 'approval-ref',
        approvalRef: `approval:${runId(taskId)}:ok`,
        approvalRequestRef: ref(taskId, 'approval-request.json'),
        guiAskUserRecordRef: ref(taskId, 'gui-ask-user.json'),
        confirmedRequestRef: ref(taskId, 'confirmed-request.json'),
        riskAuditRef: ref(taskId, 'risk-audit.json'),
        sourceApprovalRequestRef: ref(taskId, 'approval-source-request.json'),
        sourceGuiAskUserRecordRef: ref(taskId, 'approval-source-gui-ask-user.json'),
        sourceRiskAuditRef: ref(taskId, 'approval-source-risk-audit.json'),
        approvalDecisionRef: ref(taskId, 'approval-decision.json'),
        deniedExecuted: false,
      };
    case 'CU-NEXT-07':
      return {
        kind: 'dense-grounding',
        targetDescription: 'Export button in the toolbar, excluding Save and Share.',
        coarseWindowScreenshotRef: ref(taskId, 'coarse-window.png'),
        focusCropRef: ref(taskId, 'focus-crop.png'),
        fineGroundingDiagnosticRef: ref(taskId, 'fine-grounding-diagnostic.json'),
        rejectedTargetRefs: [ref(taskId, 'dense-grounding-rejections.json')],
      };
    case 'CU-NEXT-08':
      return {
        kind: 'desktop-file-save',
        targetWindowRef: ref(taskId, 'target-window.json'),
        beforeScreenshotRef: ref(taskId, 'before.png'),
        beforeAxRef: ref(taskId, 'before-ax.json'),
        guiSaveCommandRef: ref(taskId, 'gui-save-command.json'),
        executorEventRef: ref(taskId, 'executor-event.json'),
        afterScreenshotRef: ref(taskId, 'after.png'),
        afterAxRef: ref(taskId, 'after-ax.json'),
        artifactRef: ref(taskId, finalArtifactName(taskId)),
        artifactValidationRef: artifactValidationRef(taskId),
        fileCreationOwner: 'scoped-gui-save',
        sharedSystemInputUsed: false,
        shellDirectArtifactWrite: false,
      };
  }
}

function projectionRefs(taskId: CuNextTaskId): CuNextTaskMarkerProjectionRefs & { status?: CuNextProjectedAcceptanceStatus } {
  return {
    traceRef: ref(taskId, 'vision-trace.json'),
    requestRef: ref(taskId, 'computer-use-request.json'),
    verifierRef: ref(taskId, 'cu-l3-independent-input-verifier.json'),
    finalArtifactRef: ref(taskId, finalArtifactName(taskId)),
    finalVisibleScreenshotRef: ref(taskId, 'final-visible.png'),
    focusCropRefs: [ref(taskId, 'focus-crop.png')],
    groundingDiagnosticsRefs: [ref(taskId, 'grounding-diagnostics.json')],
    sessionRefs: [sessionRef(taskId)],
    approvalRequestRef: ref(taskId, 'approval-request.json'),
    guiAskUserRecordRef: ref(taskId, 'gui-ask-user.json'),
    confirmedRequestRef: ref(taskId, 'confirmed-request.json'),
    riskAuditRef: ref(taskId, 'risk-audit.json'),
    sourceApprovalRequestRef: ref(taskId, 'approval-source-request.json'),
    sourceGuiAskUserRecordRef: ref(taskId, 'approval-source-gui-ask-user.json'),
    sourceRiskAuditRef: ref(taskId, 'approval-source-risk-audit.json'),
    approvalDecisionRef: ref(taskId, 'approval-decision.json'),
    approvalRef: `approval:${runId(taskId)}:ok`,
    highRiskAction: taskId === 'CU-NEXT-03' ? 'type_text' : { actionKind: 'submit', targetDescription: 'confirmed high-risk action' },
    blockedManifestRef: ref(taskId, 'blocked-manifest.json'),
    repairHintRef: ref(taskId, 'repair-hint.json'),
    continuationRequestRef: ref(taskId, 'continuation-request.json'),
    directoryListingRef: ref(taskId, 'directory-listing.json'),
    denseGroundingRejectionRef: ref(taskId, 'dense-grounding-rejections.json'),
    denseGroundingTargetDescription: 'Export button in the toolbar, excluding Save and Share.',
  };
}

function approvalChainRefRecords(
  taskId: CuNextTaskId,
  overrides: {
    approvalRef?: string;
    approvalRequestId?: string;
    riskActionHash?: string;
    riskAuditStatus?: 'needs-confirmation' | 'confirmed';
    approvalBoundarySource?: string;
    sourceApprovalRef?: string;
  } = {},
): Record<string, unknown> {
  const approvalRef = overrides.approvalRef ?? `approval:${runId(taskId)}:ok`;
  const approvalRequestId = overrides.approvalRequestId ?? `approval-request:${runId(taskId)}`;
  const riskActionHash = overrides.riskActionHash ?? `risk-action:${runId(taskId)}`;
  const sourceApprovalRef = overrides.sourceApprovalRef ?? approvalRef;
  const refs = {
    approvalRequestRef: ref(taskId, 'approval-request.json'),
    guiAskUserRecordRef: ref(taskId, 'gui-ask-user.json'),
    confirmedRequestRef: ref(taskId, 'confirmed-request.json'),
    riskAuditRef: ref(taskId, 'risk-audit.json'),
    sourceApprovalRequestRef: ref(taskId, 'approval-source-request.json'),
    sourceGuiAskUserRecordRef: ref(taskId, 'approval-source-gui-ask-user.json'),
    sourceRiskAuditRef: ref(taskId, 'approval-source-risk-audit.json'),
    approvalDecisionRef: ref(taskId, 'approval-decision.json'),
  };
  const common = {
    approvalRequestId,
    riskActionHash,
    approvalRef,
    ...refs,
    ...(taskId === 'CU-NEXT-06' ? {
      approvalBoundary: {
        source: overrides.approvalBoundarySource ?? 'prior-fail-closed-request',
        sourceStatus: 'needs-confirmation',
        sourceApprovalRequestRef: refs.sourceApprovalRequestRef,
        sourceGuiAskUserRecordRef: refs.sourceGuiAskUserRecordRef,
        sourceRiskAuditRef: refs.sourceRiskAuditRef,
        approvalDecisionRef: refs.approvalDecisionRef,
        approvalRequestId,
        riskActionHash,
        approvalRef,
        highRiskAction: { actionKind: 'submit', targetDescription: 'confirmed high-risk action' },
      },
    } : {}),
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  };
  return {
    [refs.approvalRequestRef]: {
      schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
      status: 'needs-confirmation',
      ...common,
      approvalRequest: {
        id: approvalRequestId,
        riskActionHash,
        approvalRef,
        highRiskAction: { actionKind: 'type_text' },
      },
    },
    [refs.guiAskUserRecordRef]: {
      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
      port: 'gui.ask_user',
      status: 'needs-confirmation',
      ...common,
      payload: {
        approvalRequest: {
          id: approvalRequestId,
          riskActionHash,
        approvalRef,
        highRiskAction: { actionKind: 'type_text' },
      },
      },
    },
    [refs.confirmedRequestRef]: {
      schemaVersion: 'sciforge.computer-use.confirmed-request-sidecar.v1',
      status: 'confirmed',
      ...common,
    },
    [refs.riskAuditRef]: {
      schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
      status: overrides.riskAuditStatus ?? (taskId === 'CU-NEXT-03' ? 'needs-confirmation' : 'confirmed'),
      ...common,
      highRiskAction: { actionKind: taskId === 'CU-NEXT-03' ? 'type_text' : 'submit', targetDescription: 'confirmed high-risk action' },
    },
    ...(taskId === 'CU-NEXT-06' ? {
      [refs.sourceApprovalRequestRef]: {
        schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
        status: 'needs-confirmation',
        approvalRequestId,
        riskActionHash,
        approvalRef: sourceApprovalRef,
        sourceCopyPolicy: 'verbatim-except-bundle-local-refs',
        originalRef: ref(taskId, '../cu-next-03-source/approval-request.json'),
        originalApprovalRequestId: approvalRequestId,
        originalRiskActionHash: riskActionHash,
        originalApprovalRef: approvalRef,
        approvalRequestRef: refs.sourceApprovalRequestRef,
        guiAskUserRecordRef: refs.sourceGuiAskUserRecordRef,
        riskAuditRef: refs.sourceRiskAuditRef,
        approvalRequest: {
          id: approvalRequestId,
          riskActionHash,
          approvalRef: sourceApprovalRef,
          highRiskAction: { actionKind: 'submit' },
        },
        deniedExecuted: false,
        packageMayCallGuiDirectly: false,
      },
      [refs.sourceGuiAskUserRecordRef]: {
        schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
        port: 'gui.ask_user',
        status: 'needs-confirmation',
        approvalRequestId,
        riskActionHash,
        approvalRef: sourceApprovalRef,
        sourceCopyPolicy: 'verbatim-except-bundle-local-refs',
        originalRef: ref(taskId, '../cu-next-03-source/gui-ask-user.json'),
        originalApprovalRequestId: approvalRequestId,
        originalRiskActionHash: riskActionHash,
        originalApprovalRef: approvalRef,
        approvalRequestRef: refs.sourceApprovalRequestRef,
        guiAskUserRecordRef: refs.sourceGuiAskUserRecordRef,
        riskAuditRef: refs.sourceRiskAuditRef,
        payload: {
          approvalRequest: {
            id: approvalRequestId,
            riskActionHash,
            approvalRef: sourceApprovalRef,
            highRiskAction: { actionKind: 'submit' },
          },
        },
        deniedExecuted: false,
        packageMayCallGuiDirectly: false,
      },
      [refs.sourceRiskAuditRef]: {
        schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
        status: 'needs-confirmation',
        approvalRequestId,
        riskActionHash,
        approvalRef: sourceApprovalRef,
        sourceCopyPolicy: 'verbatim-except-bundle-local-refs',
        originalRef: ref(taskId, '../cu-next-03-source/risk-audit.json'),
        originalApprovalRequestId: approvalRequestId,
        originalRiskActionHash: riskActionHash,
        originalApprovalRef: approvalRef,
        approvalRequestRef: refs.sourceApprovalRequestRef,
        guiAskUserRecordRef: refs.sourceGuiAskUserRecordRef,
        riskAuditRef: refs.sourceRiskAuditRef,
        highRiskAction: { actionKind: 'submit', targetDescription: 'confirmed high-risk action' },
        deniedExecuted: false,
        packageMayCallGuiDirectly: false,
      },
      [refs.approvalDecisionRef]: {
        schemaVersion: 'sciforge.computer-use.approval-decision-sidecar.v1',
        status: 'confirmed',
        decision: 'approved',
        approvalRequestId,
        riskActionHash,
        approvalRef,
        sourceApprovalRequestRef: refs.sourceApprovalRequestRef,
        sourceGuiAskUserRecordRef: refs.sourceGuiAskUserRecordRef,
        sourceRiskAuditRef: refs.sourceRiskAuditRef,
        packageMayCallGuiDirectly: false,
      },
    } : {}),
  };
}

function denseGroundingRefRecords(
  taskId: CuNextTaskId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...acceptanceSupportRefRecords(taskId),
    [ref(taskId, 'dense-grounding-rejections.json')]: {
      schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
      status: 'recorded',
      selectedTarget: {
        targetDescription: 'Export button in the toolbar.',
      },
      rejectedTargets: [
        { targetDescription: 'Save button', reason: 'neighboring decoy target' },
        { targetDescription: 'Share button', reason: 'neighboring decoy target' },
      ],
      coarseWindowScreenshotRef: ref(taskId, 'coarse-window.png'),
      focusCropRef: ref(taskId, 'focus-crop.png'),
      fineGroundingDiagnosticRef: ref(taskId, 'fine-grounding-diagnostic.json'),
      ...overrides,
    },
  };
}

function acceptanceSupportRefRecords(
  taskId: CuNextTaskId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...freshnessCheckRefRecords(taskId),
    [artifactValidationRef(taskId)]: artifactValidationRecord(taskId),
    ...overrides,
  };
}

function artifactValidationRecord(taskId: CuNextTaskId): Record<string, unknown> {
  const finalArtifactRef = ref(taskId, finalArtifactName(taskId));
  const contentRefs = [finalArtifactRef];
  const sourceRefs = artifactSourceRefs(taskId);
  const format = artifactFormat(finalArtifactRef);
  return {
    schemaVersion: 'sciforge.computer-use.artifact-validation.v1',
    status: 'passed',
    ok: true,
    productAcceptanceEvidence: true,
    artifactValidationRef: artifactValidationRef(taskId),
    finalArtifactRef,
    artifactRef: finalArtifactRef,
    contentRefs,
    checkedRefs: contentRefs,
    sourceRefs,
    format,
    validator: `sciforge-generic-${format}-artifact-contract-validator`,
    sha256: createHash('sha256').update(JSON.stringify({ finalArtifactRef, contentRefs, sourceRefs })).digest('hex'),
    bytes: 128,
    currentRunCausality: true,
    metadata: {
      validationScope: 'product-smoke-record',
      productAcceptanceEvidence: true,
      finalArtifactRef,
      contentRefs,
      sourceRefs,
    },
  };
}

function artifactSourceRefs(taskId: CuNextTaskId): string[] {
  return [
    ref(taskId, 'source-facts.json'),
    ref(taskId, 'before.png'),
  ];
}

function artifactValidationRef(taskId: CuNextTaskId): string {
  return ref(taskId, `${finalArtifactName(taskId)}.validation.json`);
}

function artifactFormat(artifactRef: string): string {
  const name = artifactRef.toLowerCase().split(/[?#]/, 1)[0];
  if (name.endsWith('.pptx')) return 'pptx';
  if (name.endsWith('.odt')) return 'odt';
  if (name.endsWith('.eml')) return 'eml';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.txt')) return 'text';
  return 'file';
}

function freshnessCheckRefRecords(
  taskId: CuNextTaskId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [ref(taskId, 'freshness-check.json')]: {
      schemaVersion: 'sciforge.computer-use.freshness-check.v1',
      status: 'current',
      observedAt: '2026-05-28T00:00:00.000Z',
      checkedAt: '2026-05-28T00:00:00.000Z',
      maxAgeMs: 30_000,
      ...overrides,
    },
  };
}

function isApprovalTask(taskId: CuNextTaskId): boolean {
  return taskId === 'CU-NEXT-03' || taskId === 'CU-NEXT-06';
}

function commonEvidenceClaims(taskId: CuNextTaskId): Array<Record<string, unknown>> {
  return [
    {
      id: 'chat-origin',
      kind: 'sciForge-chat-origin',
      status: 'present',
      ref: ref(taskId, 'computer-use-request.json'),
      refs: [ref(taskId, 'computer-use-request.json')],
      origin: sciForgeChatOrigin(),
      sessionRefs: [sessionRef(taskId)],
    },
    {
      id: 'real-computer-use-trace',
      kind: 'real-computer-use',
      ref: ref(taskId, 'vision-trace.json'),
      refs: [ref(taskId, 'vision-trace.json')],
      sessionRefs: [sessionRef(taskId)],
    },
    {
      id: 'independent-input-adapter',
      kind: 'independent-input-adapter',
      refs: [ref(taskId, 'virtual-pointer-events.json'), ref(taskId, 'virtual-keyboard-events.json')],
      sessionRefs: [sessionRef(taskId)],
    },
    {
      id: 'gui-present-record',
      kind: 'gui-present-record',
      ref: ref(taskId, 'gui-present.json'),
      refs: [ref(taskId, 'gui-present.json')],
      artifactRefs: [ref(taskId, finalArtifactName(taskId))],
      sessionRefs: [sessionRef(taskId)],
    },
  ];
}

function sciForgeChatOrigin(): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.chat-origin.v1',
    handoffSource: 'ui-chat',
    entrypoint: 'sciforge-chat',
    terminalEquivalentText: true,
    selectedActionProvider: 'action.sciforge.computer-use',
    selectedToolIds: ['local.vision-sense'],
  };
}

function assertHasSciForgeChatOriginProof(taskId: CuNextTaskId, evidence: unknown): void {
  const record = evidence as Record<string, unknown>;
  const tuiHostChain = Array.isArray(record.tuiHostChain)
    ? record.tuiHostChain as Array<Record<string, unknown>>
    : [];
  const evidenceClaims = Array.isArray(record.evidenceClaims)
    ? record.evidenceClaims as Array<Record<string, unknown>>
    : [];

  assert.ok(tuiHostChain.some((link) => (
    link.kind === 'sciForge-chat-origin'
    && link.status === 'present'
    && link.requestRef === ref(taskId, 'computer-use-request.json')
    && (link.origin as Record<string, unknown> | undefined)?.entrypoint === 'sciforge-chat'
    && (link.origin as Record<string, unknown> | undefined)?.terminalEquivalentText === true
  )), `${taskId}: accepted evidence must include present tuiHostChain SciForge chat-origin proof`);
  assert.ok(evidenceClaims.some((claim) => (
    claim.kind === 'sciForge-chat-origin'
    && claim.status === 'present'
    && Array.isArray(claim.refs)
    && claim.refs.includes(ref(taskId, 'computer-use-request.json'))
    && (claim.origin as Record<string, unknown> | undefined)?.entrypoint === 'sciforge-chat'
    && (claim.origin as Record<string, unknown> | undefined)?.terminalEquivalentText === true
  )), `${taskId}: accepted evidence must include SciForge chat-origin evidenceClaim`);
}

function withoutSciForgeChatOriginProof(evidence: Record<string, unknown>): Record<string, unknown> {
  return {
    ...evidence,
    tuiHostChain: (Array.isArray(evidence.tuiHostChain) ? evidence.tuiHostChain : [])
      .filter((link) => (link as Record<string, unknown>).kind !== 'sciForge-chat-origin'),
    evidenceClaims: (Array.isArray(evidence.evidenceClaims) ? evidence.evidenceClaims : [])
      .filter((claim) => (claim as Record<string, unknown>).kind !== 'sciForge-chat-origin'),
  };
}

function virtualAppScreenUserAcceptanceManifest(
  taskId: CuNextTaskId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const id = runId(taskId);
  return deepMerge({
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-user-acceptance-manifest.v1',
    taskId: 'P0-CU-UA-FIRST-SCENARIO',
    scenarioId: 'virtual-app-screen-local-research-note',
    userIntent: 'Read local research notes in a background app screen, annotate a sentence, and produce research-note.md.',
    status: 'passed',
    createdAt: '2026-06-01T00:00:00.000Z',
    targetAppRefs: [`app:${id}/browser-research-profile`],
    targetWindowRefs: [`window:${id}/browser-research-profile/main`],
    sessionRefs: [`computer-use-session:${id}-virtual-app-screen`],
    adapterReadinessRefs: [ref(taskId, 'adapter-readiness.json')],
    screenFrameRefs: [ref(taskId, 'frames/before.png'), ref(taskId, 'frames/after.png')],
    inputIntentRefs: [ref(taskId, 'input-intents/highlight-title.json')],
    executorEventRefs: [ref(taskId, 'executor-events/highlight-title.json')],
    beforeAfterFrameRefs: [ref(taskId, 'before-after/highlight-title.json')],
    annotationProposalRefs: [ref(taskId, 'annotation-proposals/highlight-title.json')],
    artifactRefs: [ref(taskId, 'artifacts/research-note.md')],
    verificationRefs: [ref(taskId, 'verifier/research-note.json')],
    guiPresentRefs: [ref(taskId, 'gui-present/research-note.json')],
    replayRef: ref(taskId, 'replay.json'),
    evidenceLedgerRef: ref(taskId, 'evidence-ledger.json'),
    isolationFlags: {
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      physicalDisplayPopup: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      diagnosticOnly: false,
    },
    adapterReadinessRecords: [{
      adapterKind: 'browser-runtime-window',
      targetScope: 'window',
      supportedActions: ['click', 'type', 'scroll', 'hotkey', 'annotate'],
      captureSupported: true,
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    }],
    evidenceClaims: [{
      id: 'real-virtual-app-screen',
      kind: 'real-virtual-app-screen',
      status: 'present',
      ref: ref(taskId, 'evidence-ledger.json'),
      refs: [ref(taskId, 'replay.json')],
      evidenceRefs: [ref(taskId, 'before-after/highlight-title.json')],
      sessionRefs: [`computer-use-session:${id}-virtual-app-screen`],
    }],
    evidenceLedgerActions: [{
      actionId: `${id}-highlight-title`,
      sessionRef: `computer-use-session:${id}-virtual-app-screen`,
      inputIntentRef: ref(taskId, 'input-intents/highlight-title.json'),
      providerAdapterRef: ref(taskId, 'adapter-readiness.json'),
      executorEventRef: ref(taskId, 'executor-events/highlight-title.json'),
      beforeFrameRef: ref(taskId, 'frames/before.png'),
      afterFrameRef: ref(taskId, 'frames/after.png'),
      beforeAfterFrameRef: ref(taskId, 'before-after/highlight-title.json'),
      verifierRef: ref(taskId, 'verifier/research-note.json'),
      artifactRef: ref(taskId, 'artifacts/research-note.md'),
      guiPresentRef: ref(taskId, 'gui-present/research-note.json'),
    }],
    diagnosticOnly: false,
    userAcceptanceEligible: true,
    blockedReason: null,
    validation: {
      ok: true,
      issues: [],
      missingRefs: [],
      rejectedClaimKinds: [],
    },
  }, overrides);
}

function mappingFor(taskId: CuNextTaskId): typeof CU_NEXT_TASK_MAPPINGS[number] {
  const mapping = CU_NEXT_TASK_MAPPINGS.find((candidate) => candidate.taskId === taskId);
  assert.ok(mapping, `${taskId}: missing task mapping`);
  return mapping;
}

function finalArtifactName(taskId: CuNextTaskId): string {
  switch (taskId) {
    case 'CU-NEXT-01':
      return 'literature-briefing-deck.pptx';
    case 'CU-NEXT-02':
      return 'chart-report.odt';
    case 'CU-NEXT-03':
      return 'mail-draft.eml';
    case 'CU-NEXT-04':
      return 'file-index.md';
    case 'CU-NEXT-05':
      return 'submission-material.odt';
    case 'CU-NEXT-06':
      return 'approved-submission.txt';
    case 'CU-NEXT-07':
      return 'dense-grounding-export.csv';
    case 'CU-NEXT-08':
      return 'sciforge-computer-use-proof.txt';
  }
}

function ref(taskId: CuNextTaskId, name: string): string {
  return `.sciforge/vision-runs/${runId(taskId)}/${name}`;
}

function runId(taskId: CuNextTaskId): string {
  return taskId.toLowerCase();
}

function sessionRef(taskId: CuNextTaskId): string {
  return ref(taskId, 'computer-use-session.json');
}

function hasIssue(
  result: ReturnType<typeof validateCuNextLiveAcceptanceTaskEvidence>,
  id: string,
): boolean {
  return result.issues.some((issue) => issue.id === id);
}

function productSmokeIssue(
  result: ReturnType<typeof validateCuNextProductSmokeMatrix>,
  id: string,
): boolean {
  return result.issues.some((issue) => issue.id === id);
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = deepMerge(target[key] as Record<string, unknown>, value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

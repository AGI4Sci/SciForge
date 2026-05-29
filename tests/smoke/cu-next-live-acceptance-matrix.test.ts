import assert from 'node:assert/strict';
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
import { CU_NEXT_TASK_MAPPINGS } from '../../tools/computer-use-next/task-map.js';

type CuNextTaskId =
  | 'CU-NEXT-01'
  | 'CU-NEXT-02'
  | 'CU-NEXT-03'
  | 'CU-NEXT-04'
  | 'CU-NEXT-05'
  | 'CU-NEXT-06'
  | 'CU-NEXT-07';

const expectedMarkerKinds: Record<CuNextTaskId, CuNextLiveAcceptanceMarkerKind> = {
  'CU-NEXT-01': 'briefing-deck',
  'CU-NEXT-02': 'chart-report',
  'CU-NEXT-03': 'needs-confirmation',
  'CU-NEXT-04': 'file-index',
  'CU-NEXT-05': 'repair-continuity',
  'CU-NEXT-06': 'approval-ref',
  'CU-NEXT-07': 'dense-grounding',
};

test('CU-NEXT live acceptance semantic rules cover CU-NEXT-01..07 with task-specific markers', () => {
  assert.deepEqual(
    CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES.map((rule) => rule.taskId),
    Object.keys(expectedMarkerKinds),
  );
  for (const rule of CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES) {
    assert.equal(rule.markerKind, expectedMarkerKinds[rule.taskId as CuNextTaskId]);
  }
});

test('CU-NEXT live acceptance matrix accepts complete task-level semantic evidence markers', () => {
  const inputs = (Object.keys(expectedMarkerKinds) as CuNextTaskId[]).map((taskId) => liveAcceptanceInput(taskId));
  for (const input of inputs) {
    assertHasSciForgeChatOriginProof(input.taskId, input.evidence);
  }

  const results = validateCuNextLiveAcceptanceMatrix(inputs);

  assert.deepEqual(results.map((result) => result.ok), [true, true, true, true, true, true, true]);
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

test('CU-NEXT task marker projector emits validator-accepted markers for CU-NEXT-01..07', () => {
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
    },
    finalArtifactRef,
    finalVisibleScreenshotRef: ref(taskId, 'final-visible.png'),
    verifierVerdict: {
      status: 'passed',
      verdict: 'multi-app-workflow-passed',
      ref: ref(taskId, 'verifier-verdict.json'),
    },
    guiPresent: {
      status: 'present',
      recordRef: ref(taskId, 'gui-present.json'),
      payloadRef: ref(taskId, 'gui-present-payload.json'),
      displayedRefs: [finalArtifactRef],
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

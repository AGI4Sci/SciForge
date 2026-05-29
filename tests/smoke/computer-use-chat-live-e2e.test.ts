import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  runComputerUseChatLiveApprovalRetryE2E,
  runComputerUseChatLiveE2E,
  runComputerUseChatLiveContinuationE2E,
  validateComputerUseChatLiveE2EResponse,
} from '../../tools/computer-use-chat-live-e2e.js';
import { sendSciForgeToolMessage } from '../../src/ui/src/api/sciforgeToolsClient/client.js';
import type { NormalizedAgentResponse, SciForgeRun } from '../../src/ui/src/domain.js';
import {
  passedCuNext07AcceptanceManifest,
  writeBundleLocalCuNext07Acceptance,
} from './helpers/cu-next-runner-fixtures.js';
import { validateCurrentRunLiveAcceptanceBundle } from '../../tools/computer-use-next/live-acceptance-bundle.js';

test('Computer Use chat live E2E blocks before submit when live preflight is not ready', async () => {
  const manifest = await runComputerUseChatLiveE2E({
    env: {},
    localConfigs: [],
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    fetchImpl: async () => jsonResponse({ ok: true, ready: true }),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.requestSubmitted, false);
  assert.ok(manifest.issues.includes('live-preflight-not-ready'));
  assert.ok(manifest.issues.some((issue) => issue.startsWith('missing:SCIFORGE_RUNTIME_API_KEY')));
});

test('Computer Use chat live E2E submits through chat client and validates current gui.present refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-e2e-'));
  const bodies: Array<Record<string, unknown>> = [];
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const traceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
    const finalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
    const runTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      taskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-004',
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use result',
                      status: 'completed',
                      message: 'Computer Use produced a visible report.',
                      traceRefs: [traceRef],
                      artifactRefs: [finalArtifactRef],
                      runTaskChainRefs: [runTaskChainRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'completed', message: 'Computer Use completed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]?.handoffSource, 'ui-chat');
    assert.deepEqual(bodies[0]?.selectedActionIds, ['action.sciforge.computer-use']);
    const uiState = bodies[0]?.uiState as Record<string, unknown>;
    assert.deepEqual(uiState.computerUseNext, {
      taskId: 'CU-NEXT-07',
      title: 'Computer Use live task acceptance',
      requirements: [
        'chat-origin-current-run',
        'refs-first-evidence-bundle',
        'no-dom-playwright-accessibility-or-shell-file-write-substitute',
      ],
    });
    assert.deepEqual(uiState.computerUseLong, {
      cuNextTaskId: 'CU-NEXT-07',
      taskId: 'CU-NEXT-07',
      scenarioId: 'CU-LONG-004',
      title: 'Computer Use live task acceptance',
      requiredEvidence: [
        'vision-trace.json',
        'tui-host-run-task-chain.json',
        'gui.present',
        'cu-user-acceptance-manifest.json',
      ],
      safetyBoundary: {
        noDomAccessibility: true,
        noShellDirectArtifactWrite: true,
        noSharedSystemInput: true,
      },
    });
    assert.equal(manifest.status, 'completed');
    assert.deepEqual(manifest.issues, []);
    assert.equal(manifest.requestSubmitted, true);
    assert.equal(manifest.liveAcceptanceCandidate, true);
    assert.equal(manifest.liveAcceptanceBundle?.status, 'valid');
    assert.equal(manifest.liveAcceptanceBundle?.acceptanceManifestRef, '.sciforge/vision-runs/cu-next-07-wrapper/cu-user-acceptance-manifest.json');
    assert.equal(manifest.packageBridgeCompletionGrade?.status, 'attached');
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.acceptanceManifestRefs, [
      '.sciforge/vision-runs/cu-next-07-wrapper/cu-user-acceptance-manifest.json',
    ]);
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.completionEvidenceRefs, [
      '.sciforge/vision-runs/cu-next-07-wrapper/isolated-desktop-l3-workflow-evidence.json',
    ]);
    assert.ok(manifest.displayedRefs.includes(traceRef));
    assert.ok(manifest.artifactRefs.includes(finalArtifactRef));
    assert.ok(manifest.auditRefs.includes(runTaskChainRef));
    assert.match(manifest.guiPresentSource ?? '', /^gui\.present:computer-use-command-.*:computer-use$/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat request injects sanitized completion evidence policy into workspace payload', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), 'http://workspace.test/api/sciforge/tools/run/stream');
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return ndjsonResponse([
      { result: { status: 'completed', message: 'Computer Use completed.', executionUnits: [], artifacts: [] } },
    ]);
  }) as typeof fetch;
  try {
    await sendSciForgeToolMessage({
      sessionId: 'completion-evidence-policy-session',
      currentTurnId: 'turn-policy',
      scenarioId: 'literature-evidence-review',
      agentName: 'Computer Use',
      agentDomain: 'computer-use',
      prompt: '/computer-use run complete the visible task',
      references: [],
      roleView: 'researcher',
      messages: [],
      artifacts: [],
      claims: [],
      executionUnits: [],
      runs: [],
      config: {
        schemaVersion: 1,
        agentServerBaseUrl: 'http://runtime.test',
        workspaceWriterBaseUrl: 'http://workspace.test',
        workspacePath: '/tmp/sciforge-policy',
        agentBackend: 'codex',
        modelProvider: 'native',
        modelBaseUrl: '',
        modelName: '',
        apiKey: '',
        requestTimeoutMs: 60_000,
        maxContextWindowTokens: 200_000,
        visionAllowSharedSystemInput: false,
        updatedAt: '2026-05-29T00:00:00.000Z',
      },
      scenarioOverride: {
        title: 'Computer Use completion evidence policy',
        description: 'Request payload policy projection fixture',
        skillDomain: 'literature',
        scenarioMarkdown: '# Completion evidence policy',
        defaultComponents: [],
        allowedComponents: [],
        fallbackComponent: '',
        selectedSkillIds: [],
        selectedToolIds: ['local.vision-sense'],
        selectedSenseIds: ['local.vision-sense'],
        selectedActionIds: ['action.sciforge.computer-use'],
        completionEvidencePolicy: {
          schemaVersion: 'sciforge.completion-evidence-policy.v1',
          secret: 'SECRET_POLICY_SHOULD_NOT_LEAK',
          producers: [
            {
              id: 'computer-use.embedded-isolated-desktop-l3',
              enabled: true,
              trigger: 'on-completed-current-run',
              token: 'SECRET_PRODUCER_SHOULD_NOT_LEAK',
            },
            {
              id: 'computer-use.unknown-producer',
              enabled: true,
              trigger: 'on-completed-current-run',
              token: 'UNKNOWN_PRODUCER_SHOULD_NOT_LEAK',
            },
          ],
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(bodies.length, 1);
  const uiState = bodies[0]?.uiState as Record<string, unknown>;
  assert.deepEqual(uiState.completionEvidencePolicy, {
    schemaVersion: 'sciforge.completion-evidence-policy.v1',
    producers: [{
      id: 'computer-use.embedded-isolated-desktop-l3',
      enabled: true,
      trigger: 'on-completed-current-run',
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(bodies[0]),
    /SECRET_POLICY_SHOULD_NOT_LEAK|SECRET_PRODUCER_SHOULD_NOT_LEAK|UNKNOWN_PRODUCER_SHOULD_NOT_LEAK|unknown-producer/,
  );
});

test('Computer Use chat live E2E validates needs-confirmation approval request, risk audit, and denied execution proof', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-needs-confirmation-'));
  const bodies: Array<Record<string, unknown>> = [];
  const runDir = '.sciforge/vision-runs/chat-live-risk';
  const traceRef = `${runDir}/vision-trace.json`;
  const screenshotRef = `${runDir}/step-003-before-send.png`;
  const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
  const directoryListingRef = `${runDir}/directory-listing.json`;
  const approvalRequestRef = `${runDir}/approval-request.json`;
  const guiAskUserRecordRef = `${runDir}/gui-ask-user.json`;
  const riskAuditRef = `${runDir}/risk-audit.json`;
  const approvalRequest = {
    id: 'approval-request:chat-live-risk',
    approvalRef: 'approval:computer-use:chat-live-risk',
    riskActionHash: 'risk-action:chat-live-risk',
    confirmation_text: 'Allow Computer Use to send the drafted external email?',
    risk_level: 'high',
    action_kind: 'external-send',
  };
  try {
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: {
        traceRef,
        guiAskUserRecordRef,
        approvalRequestRef,
        riskAuditRef,
        directoryListingRef,
      },
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
      fileRefs: [traceRef, runTaskChainRef, guiAskUserRecordRef, approvalRequestRef, riskAuditRef],
    });
    await writeJson(join(workspace, approvalRequestRef), {
      schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
      status: 'needs-confirmation',
      approvalRequestId: 'approval-request:chat-live-risk',
      approvalRef: 'approval:computer-use:chat-live-risk',
      riskActionHash: 'risk-action:chat-live-risk',
      approvalRequest,
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
    });
    await writeJson(join(workspace, guiAskUserRecordRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
      port: 'gui.ask_user',
      status: 'needs-confirmation',
      approvalRequestId: 'approval-request:chat-live-risk',
      approvalRef: 'approval:computer-use:chat-live-risk',
      riskActionHash: 'risk-action:chat-live-risk',
      payload: { approvalRequest },
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
    });
    await writeJson(join(workspace, riskAuditRef), {
      schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
      status: 'needs-confirmation',
      approvalRequestId: 'approval-request:chat-live-risk',
      approvalRef: 'approval:computer-use:chat-live-risk',
      riskActionHash: 'risk-action:chat-live-risk',
      highRiskAction: { actionKind: 'external-send', targetDescription: 'drafted external email send control' },
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
    });

    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      expectedStatus: 'needs-confirmation',
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use guarded action',
                      status: 'needs-confirmation',
                      message: 'Computer Use stopped before the external send.',
                      traceRefs: [traceRef],
                      screenshotRefs: [screenshotRef],
                      directoryListingRefs: [directoryListingRef],
                      runTaskChainRefs: [runTaskChainRef],
                    },
                  }, {
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.ask_user',
                    target: 'computer-use.approval-request',
                    payload: {
                      approvalRequest,
                      relatedRefs: [traceRef, screenshotRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'needs-confirmation', message: 'Computer Use stopped before external send.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 1);
    assert.match(String(bodies[0]?.prompt), /gui\.ask_user confirmation/);
    assert.equal(manifest.status, 'needs-confirmation');
    assert.deepEqual(manifest.issues, []);
    assert.equal(manifest.approvalRequest?.approvalRef, 'approval:computer-use:chat-live-risk');
    assert.equal(manifest.approvalRequest?.riskLevel, 'high');
    assert.deepEqual(manifest.approvalRequestRefs, [approvalRequestRef]);
    assert.deepEqual(manifest.guiAskUserRecordRefs, [guiAskUserRecordRef]);
    assert.deepEqual(manifest.riskAuditRefs, [riskAuditRef]);
    assert.deepEqual(manifest.confirmedRequestRefs, []);
    assert.equal(manifest.deniedExecutionProof?.kind, 'explicit-sidecar-deniedExecuted-false');
    assert.ok(manifest.deniedExecutionProof?.refs.includes(riskAuditRef));
    assert.deepEqual(manifest.evidenceReadIssues, []);
    assert.equal(manifest.liveAcceptanceCandidate, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live approval retry E2E runs needs-confirmation then confirmed retry with source sidecars', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-approval-retry-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstRunDir = '.sciforge/vision-runs/chat-live-risk-round-1';
  const secondRunDir = '.sciforge/vision-runs/chat-live-risk-round-2';
  const approvalRef = 'approval:computer-use:chat-live-risk-round-1';
  const approvalRequestId = 'approval-request:chat-live-risk-round-1';
  const riskActionHash = 'risk-action:chat-live-risk-round-1';
  const firstRefs = {
    traceRef: `${firstRunDir}/vision-trace.json`,
    screenshotRef: `${firstRunDir}/step-003-before-send.png`,
    runTaskChainRef: `${firstRunDir}/tui-host-run-task-chain.json`,
    directoryListingRef: `${firstRunDir}/directory-listing.json`,
    approvalRequestRef: `${firstRunDir}/approval-request.json`,
    guiAskUserRecordRef: `${firstRunDir}/gui-ask-user.json`,
    riskAuditRef: `${firstRunDir}/risk-audit.json`,
  };
  const secondRefs = {
    traceRef: `${secondRunDir}/vision-trace.json`,
    runTaskChainRef: `${secondRunDir}/tui-host-run-task-chain.json`,
    directoryListingRef: `${secondRunDir}/directory-listing.json`,
    confirmedRequestRef: `${secondRunDir}/confirmed-request.json`,
    approvalDecisionRef: `${secondRunDir}/approval-decision.json`,
    sourceApprovalRequestRef: `${secondRunDir}/approval-source-request.json`,
    sourceGuiAskUserRecordRef: `${secondRunDir}/approval-source-gui-ask-user.json`,
    sourceRiskAuditRef: `${secondRunDir}/approval-source-risk-audit.json`,
    riskAuditRef: `${secondRunDir}/risk-audit.json`,
  };
  const approvalRequest = {
    id: approvalRequestId,
    approvalRef,
    riskActionHash,
    confirmation_text: 'Allow Computer Use to send the drafted external email?',
    risk_level: 'high',
    action_kind: 'external-send',
  };
  try {
    await writeNeedsConfirmationSidecars(workspace, {
      ...firstRefs,
      approvalRef,
      approvalRequestId,
      riskActionHash,
      approvalRequest,
    });
    await writeConfirmedApprovalSidecars(workspace, {
      ...secondRefs,
      approvalRef,
      approvalRequestId,
      riskActionHash,
    });

    const manifest = await runComputerUseChatLiveApprovalRetryE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: isSecond ? [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use confirmed action',
                      status: 'completed',
                      message: 'Computer Use retried with explicit approval.',
                      traceRefs: [secondRefs.traceRef],
                      directoryListingRefs: [secondRefs.directoryListingRef],
                      runTaskChainRefs: [secondRefs.runTaskChainRef],
                      confirmedRequestRefs: [secondRefs.confirmedRequestRef],
                      approvalDecisionRefs: [secondRefs.approvalDecisionRef],
                      riskAuditRefs: [secondRefs.riskAuditRef],
                      sourceApprovalRefs: [
                        secondRefs.sourceApprovalRequestRef,
                        secondRefs.sourceGuiAskUserRecordRef,
                        secondRefs.sourceRiskAuditRef,
                      ],
                    },
                  }] : [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use guarded action',
                      status: 'needs-confirmation',
                      message: 'Computer Use stopped before the external send.',
                      traceRefs: [firstRefs.traceRef],
                      screenshotRefs: [firstRefs.screenshotRef],
                      directoryListingRefs: [firstRefs.directoryListingRef],
                      runTaskChainRefs: [firstRefs.runTaskChainRef],
                      approvalRequestRefs: [firstRefs.approvalRequestRef],
                      riskAuditRefs: [firstRefs.riskAuditRef],
                    },
                  }, {
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.ask_user',
                    target: 'computer-use.approval-request',
                    payload: {
                      approvalRequest,
                      relatedRefs: [
                        firstRefs.traceRef,
                        firstRefs.approvalRequestRef,
                        firstRefs.guiAskUserRecordRef,
                        firstRefs.riskAuditRef,
                      ],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'needs-confirmation',
                message: isSecond ? 'Computer Use confirmed retry completed.' : 'Computer Use stopped before external send.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(String(bodies[1]?.prompt), `/computer-use approve --approval-ref ${approvalRef}`);
    const humanApproval = bodies[1]?.humanApproval as Record<string, unknown>;
    const provenance = humanApproval.approvalProvenance as Record<string, unknown>;
    assert.equal(humanApproval.approvalRef, approvalRef);
    assert.equal(provenance.sourceApprovalRequestRef, firstRefs.approvalRequestRef);
    assert.equal(provenance.sourceGuiAskUserRecordRef, firstRefs.guiAskUserRecordRef);
    assert.equal(provenance.sourceRiskAuditRef, firstRefs.riskAuditRef);
    assert.equal((provenance.approvalRequestSidecar as Record<string, unknown>).approvalRef, approvalRef);
    assert.equal((provenance.riskAuditSidecar as Record<string, unknown>).riskActionHash, riskActionHash);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    assert.deepEqual(manifest.issues, []);
    assert.equal(manifest.requestSubmitted, true);
    assert.equal(manifest.firstTurn.status, 'needs-confirmation');
    assert.equal(manifest.secondTurn?.status, 'confirmed-approval-retry');
    assert.deepEqual(manifest.approvalRetry.reusedSourceRefs, [
      firstRefs.approvalRequestRef,
      firstRefs.guiAskUserRecordRef,
      firstRefs.riskAuditRef,
    ]);
    assert.deepEqual(manifest.approvalRetry.requestEvidence, {
      approvalRef: true,
      sourceApprovalRequest: true,
      sourceGuiAskUser: true,
      sourceRiskAudit: true,
      approvalProvenanceSidecars: true,
      notSessionDerivedApprovalRef: true,
    });
	    assert.deepEqual(manifest.approvalRetry.eventEvidence, {
	      approvalRef: true,
	      sourceApprovalRequest: true,
	      sourceGuiAskUser: true,
	      sourceRiskAudit: true,
	      approvalProvenanceSidecars: true,
	      notSessionDerivedApprovalRef: true,
	    });
	    assert.deepEqual(manifest.approvalRetry.archiveProof.firstRunRefs, {
	      approvalRequestRefs: [firstRefs.approvalRequestRef],
	      guiAskUserRecordRefs: [firstRefs.guiAskUserRecordRef],
	      riskAuditRefs: [firstRefs.riskAuditRef],
	      confirmedRequestRefs: [],
	    });
	    assert.deepEqual(manifest.approvalRetry.archiveProof.secondRunRefs, {
	      sourceApprovalRequestRefs: [secondRefs.sourceApprovalRequestRef],
	      sourceGuiAskUserRecordRefs: [secondRefs.sourceGuiAskUserRecordRef],
	      sourceRiskAuditRefs: [secondRefs.sourceRiskAuditRef],
	      approvalDecisionRefs: [secondRefs.approvalDecisionRef],
	      confirmedRequestRefs: [secondRefs.confirmedRequestRef],
	      riskAuditRefs: [secondRefs.riskAuditRef],
	    });
	    assert.equal(manifest.approvalRetry.archiveProof.priorSourceSidecars.approvalRequest?.ref, firstRefs.approvalRequestRef);
	    assert.equal(manifest.approvalRetry.archiveProof.priorSourceSidecars.approvalRequest?.deniedExecuted, false);
	    assert.match(manifest.approvalRetry.archiveProof.priorSourceSidecars.approvalRequest?.sha256 ?? '', /^[a-f0-9]{64}$/);
	    assert.equal(manifest.approvalRetry.archiveProof.currentRunSourceSidecars.approvalRequest?.ref, secondRefs.sourceApprovalRequestRef);
	    assert.match(manifest.approvalRetry.archiveProof.currentRunSourceSidecars.approvalRequest?.sha256 ?? '', /^[a-f0-9]{64}$/);
	    assert.equal(manifest.approvalRetry.archiveProof.currentRunConfirmedSidecars.approvalDecision?.ref, secondRefs.approvalDecisionRef);
	    assert.equal(manifest.approvalRetry.archiveProof.currentRunConfirmedSidecars.approvalDecision?.decision, 'approved');
	    assert.equal(manifest.approvalRetry.archiveProof.currentRunConfirmedSidecars.confirmedRequest?.ref, secondRefs.confirmedRequestRef);
	    assert.equal(manifest.approvalRetry.archiveProof.currentRunConfirmedSidecars.riskAudit?.ref, secondRefs.riskAuditRef);
	    assert.equal(manifest.approvalRetry.archiveProof.deniedBeforeConfirmed.deniedExecutedFalse, true);
	    assert.deepEqual(manifest.approvalRetry.archiveProof.deniedBeforeConfirmed.confirmedRequestRefsBeforeApproval, []);
	    assert.ok(manifest.approvalRetry.archiveProof.deniedBeforeConfirmed.proofRefs.includes(secondRefs.confirmedRequestRef));
	    assert.deepEqual(manifest.approvalRetry.archiveProof.issues, []);
	  } finally {
	    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live approval retry E2E rejects retry when current-run source sidecar is missing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-approval-retry-missing-sidecar-'));
  const firstRunDir = '.sciforge/vision-runs/chat-live-risk-missing-round-1';
  const secondRunDir = '.sciforge/vision-runs/chat-live-risk-missing-round-2';
  const approvalRef = 'approval:computer-use:chat-live-risk-missing-round-1';
  const approvalRequestId = 'approval-request:chat-live-risk-missing-round-1';
  const riskActionHash = 'risk-action:chat-live-risk-missing-round-1';
  const firstRefs = {
    traceRef: `${firstRunDir}/vision-trace.json`,
    screenshotRef: `${firstRunDir}/step-003-before-send.png`,
    runTaskChainRef: `${firstRunDir}/tui-host-run-task-chain.json`,
    directoryListingRef: `${firstRunDir}/directory-listing.json`,
    approvalRequestRef: `${firstRunDir}/approval-request.json`,
    guiAskUserRecordRef: `${firstRunDir}/gui-ask-user.json`,
    riskAuditRef: `${firstRunDir}/risk-audit.json`,
  };
  const secondRefs = {
    traceRef: `${secondRunDir}/vision-trace.json`,
    runTaskChainRef: `${secondRunDir}/tui-host-run-task-chain.json`,
    directoryListingRef: `${secondRunDir}/directory-listing.json`,
    confirmedRequestRef: `${secondRunDir}/confirmed-request.json`,
    approvalDecisionRef: `${secondRunDir}/approval-decision.json`,
    sourceApprovalRequestRef: `${secondRunDir}/approval-source-request.json`,
    sourceGuiAskUserRecordRef: `${secondRunDir}/approval-source-gui-ask-user.json`,
    sourceRiskAuditRef: `${secondRunDir}/approval-source-risk-audit.json`,
    riskAuditRef: `${secondRunDir}/risk-audit.json`,
  };
  const approvalRequest = {
    id: approvalRequestId,
    approvalRef,
    riskActionHash,
    confirmation_text: 'Allow Computer Use to send the drafted external email?',
    risk_level: 'high',
    action_kind: 'external-send',
  };
  let requestCount = 0;
  try {
    await writeNeedsConfirmationSidecars(workspace, {
      ...firstRefs,
      approvalRef,
      approvalRequestId,
      riskActionHash,
      approvalRequest,
    });
    await writeConfirmedApprovalSidecars(workspace, {
      ...secondRefs,
      approvalRef,
      approvalRequestId,
      riskActionHash,
    });
    await rm(join(workspace, secondRefs.sourceRiskAuditRef), { force: true });

    const manifest = await runComputerUseChatLiveApprovalRetryE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          requestCount += 1;
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = requestCount === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: isSecond ? [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use confirmed action',
                      status: 'completed',
                      traceRefs: [secondRefs.traceRef],
                      directoryListingRefs: [secondRefs.directoryListingRef],
                      runTaskChainRefs: [secondRefs.runTaskChainRef],
                      confirmedRequestRefs: [secondRefs.confirmedRequestRef],
                      approvalDecisionRefs: [secondRefs.approvalDecisionRef],
                      riskAuditRefs: [secondRefs.riskAuditRef],
                      sourceApprovalRefs: [
                        secondRefs.sourceApprovalRequestRef,
                        secondRefs.sourceGuiAskUserRecordRef,
                        secondRefs.sourceRiskAuditRef,
                      ],
                    },
                  }] : [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use guarded action',
                      status: 'needs-confirmation',
                      traceRefs: [firstRefs.traceRef],
                      directoryListingRefs: [firstRefs.directoryListingRef],
                      runTaskChainRefs: [firstRefs.runTaskChainRef],
                      approvalRequestRefs: [firstRefs.approvalRequestRef],
                      riskAuditRefs: [firstRefs.riskAuditRef],
                    },
                  }, {
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.ask_user',
                    target: 'computer-use.approval-request',
                    payload: {
                      approvalRequest,
                      relatedRefs: [
                        firstRefs.traceRef,
                        firstRefs.approvalRequestRef,
                        firstRefs.guiAskUserRecordRef,
                        firstRefs.riskAuditRef,
                      ],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'needs-confirmation',
                message: isSecond ? 'Computer Use confirmed retry completed.' : 'Computer Use stopped before external send.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(manifest.status, 'failed');
    assert.ok(manifest.issues.includes('confirmed-retry-missing-source-risk-audit-sidecar'));
    assert.ok(manifest.issues.includes('approval-retry-current-run-source-risk-audit-missing-sha256'));
    assert.equal(manifest.approvalRetry.archiveProof.currentRunSourceSidecars.riskAudit?.sha256, undefined);
    assert.deepEqual(manifest.approvalRetry.archiveProof.secondRunRefs.sourceRiskAuditRefs, [secondRefs.sourceRiskAuditRef]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live E2E validates confirmed approval retry chain sidecars', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-confirmed-approval-'));
  const bodies: Array<Record<string, unknown>> = [];
  const runDir = '.sciforge/vision-runs/chat-live-risk-confirmed';
  const priorRunDir = '.sciforge/vision-runs/chat-live-risk';
  const approvalRef = 'approval:computer-use:chat-live-risk';
  const approvalRequestId = 'approval-request:chat-live-risk';
  const riskActionHash = 'risk-action:chat-live-risk';
  const traceRef = `${runDir}/vision-trace.json`;
  const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
  const directoryListingRef = `${runDir}/directory-listing.json`;
  const confirmedRequestRef = `${runDir}/confirmed-request.json`;
  const approvalDecisionRef = `${runDir}/approval-decision.json`;
  const riskAuditRef = `${runDir}/risk-audit.json`;
  const sourceApprovalRequestRef = `${runDir}/approval-source-request.json`;
  const sourceGuiAskUserRecordRef = `${runDir}/approval-source-gui-ask-user.json`;
  const sourceRiskAuditRef = `${runDir}/approval-source-risk-audit.json`;
  const approvalRequest = {
    id: approvalRequestId,
    approvalRef,
    riskActionHash,
    riskLevel: 'high',
    actionKind: 'external-send',
  };
  try {
    const sourceRefs = { sourceApprovalRequestRef, sourceGuiAskUserRecordRef, sourceRiskAuditRef };
    const confirmedRefs = {
      confirmedRequestRef,
      approvalDecisionRef,
      riskAuditRef,
      ...sourceRefs,
    };
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: {
        traceRef,
        directoryListingRef,
        confirmedRequestRef,
        approvalDecisionRef,
        riskAuditRef,
        sourceApprovalRequestRef,
        sourceGuiAskUserRecordRef,
        sourceRiskAuditRef,
      },
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
      fileRefs: [
        traceRef,
        runTaskChainRef,
        confirmedRequestRef,
        approvalDecisionRef,
        riskAuditRef,
        sourceApprovalRequestRef,
        sourceGuiAskUserRecordRef,
        sourceRiskAuditRef,
      ],
    });
    await writeJson(join(workspace, sourceApprovalRequestRef), {
      schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
      status: 'needs-confirmation',
      approvalRequestId,
      approvalRef,
      riskActionHash,
      approvalRequest,
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
      originalRef: `${priorRunDir}/approval-request.json`,
    });
    await writeJson(join(workspace, sourceGuiAskUserRecordRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
      port: 'gui.ask_user',
      status: 'needs-confirmation',
      approvalRequestId,
      approvalRef,
      riskActionHash,
      payload: { approvalRequest },
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
      originalRef: `${priorRunDir}/gui-ask-user.json`,
    });
    await writeJson(join(workspace, sourceRiskAuditRef), {
      schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
      status: 'needs-confirmation',
      approvalRequestId,
      approvalRef,
      riskActionHash,
      highRiskAction: { actionKind: 'external-send' },
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
      originalRef: `${priorRunDir}/risk-audit.json`,
    });
    await writeJson(join(workspace, confirmedRequestRef), {
      schemaVersion: 'sciforge.computer-use.confirmed-request-sidecar.v1',
      status: 'confirmed',
      approvalRequestId,
      approvalRef,
      riskActionHash,
      ...confirmedRefs,
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
      approvalBoundary: {
        source: 'prior-fail-closed-request',
        sourceStatus: 'needs-confirmation',
        approvalRef,
        approvalRequestId,
        riskActionHash,
        ...confirmedRefs,
      },
    });
    await writeJson(join(workspace, approvalDecisionRef), {
      schemaVersion: 'sciforge.computer-use.approval-decision-sidecar.v1',
      status: 'confirmed',
      decision: 'approved',
      approvalRequestId,
      approvalRef,
      riskActionHash,
      ...confirmedRefs,
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
    });
    await writeJson(join(workspace, riskAuditRef), {
      schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
      status: 'confirmed',
      approvalRequestId,
      approvalRef,
      riskActionHash,
      highRiskAction: { actionKind: 'external-send' },
      ...confirmedRefs,
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
    });

    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      expectedStatus: 'confirmed-approval-retry',
      prompt: `/computer-use approve --approval-ref "${approvalRef}"`,
      runs: [priorNeedsConfirmationRun({ approvalRef, approvalRequest, priorRunDir })],
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use confirmed action',
                      status: 'completed',
                      message: 'Computer Use retried with explicit approval.',
                      traceRefs: [traceRef],
                      directoryListingRefs: [directoryListingRef],
                      runTaskChainRefs: [runTaskChainRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'completed', message: 'Computer Use confirmed retry completed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    const humanApproval = bodies[0]?.humanApproval as Record<string, unknown>;
    assert.equal(humanApproval.approvalRef, approvalRef);
    assert.equal((humanApproval.approvalProvenance as Record<string, unknown>).source, 'prior-gui-ask-user');
    assert.equal(manifest.status, 'confirmed-approval-retry', JSON.stringify(manifest.issues));
    assert.deepEqual(manifest.issues, []);
    assert.equal(manifest.confirmedApproval?.approvalRef, approvalRef);
    assert.equal(manifest.confirmedApproval?.approvalRequestId, approvalRequestId);
    assert.equal(manifest.confirmedApproval?.riskActionHash, riskActionHash);
    assert.deepEqual(manifest.sourceApprovalRequestRefs, [sourceApprovalRequestRef]);
    assert.deepEqual(manifest.sourceGuiAskUserRecordRefs, [sourceGuiAskUserRecordRef]);
    assert.deepEqual(manifest.sourceRiskAuditRefs, [sourceRiskAuditRef]);
    assert.deepEqual(manifest.approvalDecisionRefs, [approvalDecisionRef]);
    assert.deepEqual(manifest.confirmedRequestRefs, [confirmedRequestRef]);
    assert.deepEqual(manifest.riskAuditRefs, [riskAuditRef]);
    assert.equal(manifest.liveAcceptanceCandidate, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live E2E rejects confirmed retry using session-derived approvalRef', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-session-derived-approval-'));
  const runDir = '.sciforge/vision-runs/chat-live-session-derived-confirmed';
  const approvalRef = 'approval:session:computer-use-chat-live-e2e-123';
  const approvalRequestId = 'approval-request:session-derived';
  const riskActionHash = 'risk-action:session-derived';
  const refs = {
    traceRef: `${runDir}/vision-trace.json`,
    runTaskChainRef: `${runDir}/tui-host-run-task-chain.json`,
    directoryListingRef: `${runDir}/directory-listing.json`,
    confirmedRequestRef: `${runDir}/confirmed-request.json`,
    approvalDecisionRef: `${runDir}/approval-decision.json`,
    sourceApprovalRequestRef: `${runDir}/approval-source-request.json`,
    sourceGuiAskUserRecordRef: `${runDir}/approval-source-gui-ask-user.json`,
    sourceRiskAuditRef: `${runDir}/approval-source-risk-audit.json`,
    riskAuditRef: `${runDir}/risk-audit.json`,
  };
  try {
    await writeConfirmedApprovalSidecars(workspace, {
      ...refs,
      approvalRef,
      approvalRequestId,
      riskActionHash,
    });

    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      expectedStatus: 'confirmed-approval-retry',
      prompt: `/computer-use approve --approval-ref "${approvalRef}"`,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use confirmed action',
                      status: 'completed',
                      traceRefs: [refs.traceRef],
                      directoryListingRefs: [refs.directoryListingRef],
                      runTaskChainRefs: [refs.runTaskChainRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'completed', message: 'Computer Use confirmed retry completed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(manifest.status, 'failed');
    assert.ok(manifest.issues.includes('confirmed-retry-session-derived-approval-ref'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live E2E rejects completed chat results without current-run acceptance bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-no-bundle-'));
  try {
    const traceRef = '.sciforge/vision-runs/current-run/vision-trace.json';
    const finalArtifactRef = '.sciforge/vision-runs/current-run/report.md';
    const runTaskChainRef = '.sciforge/vision-runs/current-run/tui-host-run-task-chain.json';
    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use result',
                      status: 'completed',
                      message: 'Computer Use produced a visible report.',
                      traceRefs: [traceRef],
                      artifactRefs: [finalArtifactRef],
                      runTaskChainRefs: [runTaskChainRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'completed', message: 'Computer Use completed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.liveAcceptanceCandidate, false);
    assert.equal(manifest.liveAcceptanceBundle?.acceptanceManifestRef, '.sciforge/vision-runs/current-run/cu-user-acceptance-manifest.json');
    assert.equal(manifest.packageBridgeCompletionGrade?.status, 'missing');
    assert.ok(manifest.issues.includes(
      'completion-grade: package bridge completion-grade evidence must be attached for completed chat Computer Use run (fail-closed).',
    ));
    assert.ok(manifest.issues.some((issue) => issue.includes('cu-user-acceptance-manifest.json is missing')));
    assert.ok(manifest.failureDiagnostics.some((diagnostic) => (
      diagnostic.kind === 'canonical-l3-missing'
      && diagnostic.summary.includes('isolated-desktop-l3-workflow-evidence.json')
      && diagnostic.refs.includes(finalArtifactRef)
    )));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live E2E surfaces package bridge completion-grade diagnostics when manifest is missing', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-diagnostic-bundle-'));
  try {
    const runDir = '.sciforge/vision-runs/current-run';
    const traceRef = `${runDir}/vision-trace.json`;
    const finalArtifactRef = `${runDir}/report.md`;
    const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
    const directoryListingRef = `${runDir}/directory-listing.json`;
    const diagnosticRef = `${runDir}/completion-grade-diagnostics.json`;
    const producerDiagnosticRef = `${runDir}/embedded-l3-completion-producer-diagnostics.json`;
    await writeJson(join(workspace, traceRef), {
      schemaVersion: 'sciforge.computer-use.package-bridge-trace.v1',
      status: 'done',
      finalArtifactRef,
    });
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      links: [
        { kind: 'directory-listing', status: 'present', recordRef: directoryListingRef },
        { kind: 'completion-grade-evidence', status: 'blocked', recordRef: diagnosticRef },
      ],
      completionGrade: {
        status: 'blocked',
        diagnosticRef,
        producerDiagnosticRef,
      },
    });
    await writeJson(join(workspace, directoryListingRef), {
      schemaVersion: 'sciforge.computer-use.directory-listing.v1',
      fileRefs: [traceRef, finalArtifactRef, runTaskChainRef, diagnosticRef, producerDiagnosticRef],
    });
    await writeJson(join(workspace, diagnosticRef), {
      schemaVersion: 'sciforge.computer-use.completion-grade-diagnostic.v1',
      status: 'blocked',
      reason: 'completed Computer Use package bridge run is fail-closed for completion-grade evidence: isolated-desktop-l3-workflow-evidence.json is missing or not a current-run regular file.',
      issues: ['missing current-run isolated-desktop-l3-workflow-evidence.json'],
      expectedCompletionEvidenceRef: `${runDir}/isolated-desktop-l3-workflow-evidence.json`,
    });
    await writeJson(join(workspace, producerDiagnosticRef), {
      schemaVersion: 'sciforge.computer-use.embedded-l3-completion-producer-diagnostic.v1',
      status: 'blocked',
      reason: 'embedded L3 completion producer exited code=1 signal=null',
      sourceDirRef: `${runDir}/evidence/l3`,
      envGateName: 'SCIFORGE_RUN_REAL_L3_WORKFLOW',
      allowedEnvKeys: ['PATH', 'LANG', 'LC_ALL', 'PYTHONPATH'],
      process: {
        command: 'python',
        args: [
          '-m',
          'sciforge_l3',
          '--provider-url=https://provider.example/v1',
          '--api-key',
          'sk-producer-secret-123456',
          '--model=gpt-secret-model',
          '--token=producer-token-123',
          '--password',
          'producer-password-123',
        ],
        code: 1,
        signal: null,
        timedOut: false,
        stdout: 'stdout: providerUrl=https://provider.example/v1 model=gpt-secret-model token=producer-token-123 bounded producer stdout context',
        stderr: 'stderr: Authorization: Bearer producer-auth-token password=producer-password-123 api_key=sk-producer-secret-123456 bounded producer stderr context',
      },
      sourceReadinessStatus: ['isolated-desktop-l3-workflow-probe-manifest.json:blocked'],
      sourceBlockedReasons: ['Linux noVNC + LibreOffice/browser backend readiness is not satisfied.'],
    });

    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use result',
                      status: 'completed',
                      message: 'Computer Use produced a visible report.',
                      traceRefs: [traceRef],
                      artifactRefs: [finalArtifactRef],
                      runTaskChainRefs: [runTaskChainRef],
                      directoryListingRefs: [directoryListingRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'completed', message: 'Computer Use completed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.liveAcceptanceBundle?.status, 'missing');
    assert.equal(manifest.packageBridgeCompletionGrade?.status, 'blocked');
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.diagnosticRefs, [diagnosticRef]);
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.producerDiagnosticRefs, [producerDiagnosticRef]);
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.producerDiagnosticIssues, ['embedded L3 completion producer exited code=1 signal=null']);
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.sourceReadinessStatus, ['isolated-desktop-l3-workflow-probe-manifest.json:blocked']);
    assert.deepEqual(manifest.packageBridgeCompletionGrade?.sourceBlockedReasons, ['Linux noVNC + LibreOffice/browser backend readiness is not satisfied.']);
    assert.equal(manifest.packageBridgeCompletionGrade?.processDiagnosticSummaries.length, 3);
    assert.ok(manifest.packageBridgeCompletionGrade?.processDiagnosticSummaries.some((summary) => summary.includes('embedded L3 producer process')));
    assert.ok(manifest.packageBridgeCompletionGrade?.processDiagnosticSummaries.some((summary) => summary.includes('embedded L3 producer stdout')));
    assert.ok(manifest.packageBridgeCompletionGrade?.processDiagnosticSummaries.some((summary) => summary.includes('embedded L3 producer stderr')));
    assert.match(manifest.packageBridgeCompletionGrade?.reason ?? '', /fail-closed/);
    assert.ok(manifest.issues.some((issue) => issue.includes('package bridge completion-grade blocked')));
    assert.ok(manifest.issues.some((issue) => issue.includes('missing current-run isolated-desktop-l3-workflow-evidence.json')));
    assert.ok(manifest.issues.some((issue) => issue.includes('embedded L3 producer diagnostic')));
    assert.ok(manifest.issues.some((issue) => issue.includes('embedded L3 source blocker')));
    const producerFailure = manifest.failureDiagnostics.find((diagnostic) => (
      diagnostic.kind === 'canonical-l3-producer-failure'
      && diagnostic.refs.includes(producerDiagnosticRef)
      && diagnostic.summary.includes('source blocker')
    ));
    assert.ok(producerFailure);
    assert.match(producerFailure.summary, /process|stdout|stderr/);
    const serialized = JSON.stringify(manifest);
    assert.doesNotMatch(serialized, /provider\.example|sk-producer-secret|gpt-secret-model|producer-token|producer-password|producer-auth-token/i);
    assert.match(serialized, /\[redacted-url\]|\[redacted-secret\]/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live E2E surfaces sanitized package bridge process failure diagnostics from trace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-package-process-diagnostics-'));
  try {
    const runDir = '.sciforge/vision-runs/package-process-failed';
    const traceRef = `${runDir}/vision-trace.json`;
    const runTaskChainRef = `${runDir}/tui-host-run-task-chain.json`;
    await writeJson(join(workspace, traceRef), {
      schemaVersion: 'sciforge.vision-sense.trace.v1',
      packageResult: {
        schemaVersion: 'sciforge.computer-use.result.v1',
        status: 'failed-with-reason',
        reason: 'Computer Use package process exited without finalResult.',
        failureDiagnostics: {
          failedStage: 'package-bridge',
          stdout: 'stdout summary provider_url=https://provider.example/v1 model=secret-model token=stdout-token bounded stdout',
          stderr: 'stderr summary Authorization: Bearer package-auth-token apiKey=sk-package-secret-123456 password=package-password bounded stderr',
          process: {
            command: 'python',
            args: [
              '-m',
              'sciforge_computer_use',
              '--provider-url=https://provider.example/v1',
              '--api-key',
              'sk-package-secret-123456',
              '--model=secret-model',
              '--token=package-token',
              '--password',
              'package-password',
            ],
            code: 17,
            signal: null,
            timedOut: true,
            timeoutMs: 2500,
            stdout: 'process stdout should be shadowed by bounded top-level stdout',
            stderr: 'process stderr should be shadowed by bounded top-level stderr',
          },
        },
      },
    });
    await writeJson(join(workspace, runTaskChainRef), {
      schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
      refs: { traceRef },
    });

    const manifest = await runComputerUseChatLiveE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: 'Computer Use failed',
                      status: 'blocked',
                      message: 'Computer Use package bridge failed before producing a final result.',
                      traceRefs: [traceRef],
                      runTaskChainRefs: [runTaskChainRef],
                    },
                  }],
                },
              },
            },
            { result: { status: 'failed', message: 'Computer Use package process failed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(manifest.status, 'failed');
    const diagnostic = manifest.failureDiagnostics.find((item) => item.kind === 'package-bridge-process-failure');
    assert.ok(diagnostic);
    assert.ok(diagnostic.refs.includes(traceRef));
    assert.match(diagnostic.summary, /package-bridge process/);
    assert.match(diagnostic.summary, /stdout/);
    assert.match(diagnostic.summary, /stderr/);
    assert.match(diagnostic.summary, /exit=17/);
    assert.match(diagnostic.summary, /timedOut=true/);
    const serialized = JSON.stringify(manifest);
    assert.doesNotMatch(serialized, /provider\.example|sk-package-secret|secret-model|stdout-token|package-token|package-password|package-auth-token/i);
    assert.match(serialized, /\[redacted-url\]|\[redacted-secret\]/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live E2E validator rejects gui.present final artifact mismatch', () => {
  const manifest = validateComputerUseChatLiveE2EResponse({
    expectedStatus: 'completed',
    prompt: '/computer-use read-only smoke',
    checkedAt: '2026-05-29T00:00:00.000Z',
    preflight: readyPreflight(),
    response: {
      message: {} as NormalizedAgentResponse['message'],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      run: {
        id: 'run-mismatch',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: '/computer-use read-only smoke',
        response: 'done',
        createdAt: '2026-05-29T00:00:00.000Z',
        raw: {
          guiPresentation: {
            source: 'gui.present:run-mismatch:computer-use',
            displayedRefs: ['.sciforge/vision-runs/mismatch/vision-trace.json'],
          },
          displayIntent: {
            conversationProjection: {
              visibleAnswer: {
                status: 'output-materialized',
                artifactRefs: ['.sciforge/vision-runs/mismatch/report.md'],
              },
              artifacts: [{ ref: '.sciforge/vision-runs/mismatch/report.md' }],
              auditRefs: ['.sciforge/vision-runs/mismatch/tui-host-run-task-chain.json'],
            },
          },
        },
      },
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.ok(manifest.issues.includes('gui-present-missing-final-artifact-ref'));
  assert.ok(manifest.failureDiagnostics.some((diagnostic) => (
    diagnostic.kind === 'gui-present-final-artifact-binding'
    && diagnostic.summary.includes('.sciforge/vision-runs/mismatch/report.md')
  )));
});

test('Computer Use chat live E2E validator explains completed status without final artifact', () => {
  const manifest = validateComputerUseChatLiveE2EResponse({
    expectedStatus: 'completed',
    prompt: '/computer-use completed without artifact',
    checkedAt: '2026-05-29T00:00:00.000Z',
    preflight: readyPreflight(),
    events: [{
      id: 'event-run-no-final-artifact',
      type: 'computer-use.tui-host-actions',
      label: 'Computer Use host actions',
      detail: JSON.stringify({ actions: [] }),
      createdAt: '2026-05-29T00:00:00.000Z',
    }],
    response: {
      message: {} as NormalizedAgentResponse['message'],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      run: {
        id: 'run-no-final-artifact',
        scenarioId: 'literature-evidence-review',
        status: 'completed',
        prompt: '/computer-use completed without artifact',
        response: 'done',
        createdAt: '2026-05-29T00:00:00.000Z',
        raw: {
          guiPresentation: {
            source: 'gui.present:run-no-final-artifact:computer-use',
            displayedRefs: [
              '.sciforge/vision-runs/no-final/vision-trace.json',
              '.sciforge/vision-runs/no-final/tui-host-run-task-chain.json',
            ],
          },
          displayIntent: {
            conversationProjection: {
              visibleAnswer: {
                status: 'output-materialized',
                artifactRefs: [],
              },
              artifacts: [],
              auditRefs: ['.sciforge/vision-runs/no-final/tui-host-run-task-chain.json'],
            },
          },
        },
      },
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.ok(manifest.issues.includes('completed-run-missing-artifact-ref'));
  assert.ok(manifest.failureDiagnostics.some((diagnostic) => (
    diagnostic.kind === 'missing-final-artifact'
    && diagnostic.refs.includes('.sciforge/vision-runs/no-final/tui-host-run-task-chain.json')
  )));
});

test('Computer Use chat live E2E validator rejects needs-confirmation without risk audit evidence', () => {
  const traceRef = '.sciforge/vision-runs/no-risk-audit/vision-trace.json';
  const runTaskChainRef = '.sciforge/vision-runs/no-risk-audit/tui-host-run-task-chain.json';
  const manifest = validateComputerUseChatLiveE2EResponse({
    expectedStatus: 'needs-confirmation',
    prompt: '/computer-use guarded smoke',
    checkedAt: '2026-05-29T00:00:00.000Z',
    preflight: readyPreflight(),
    events: [{
      id: 'evt-computer-use-host-actions',
      type: 'computer-use.tui-host-actions',
      label: 'Computer Use host actions',
      createdAt: '2026-05-29T00:00:00.000Z',
    }],
    response: {
      message: {} as NormalizedAgentResponse['message'],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      run: {
        id: 'run-no-risk-audit',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: '/computer-use guarded smoke',
        response: 'needs confirmation',
        createdAt: '2026-05-29T00:00:00.000Z',
        raw: {
          guiPresentation: {
            source: 'gui.present:run-no-risk-audit:computer-use',
            displayedRefs: [traceRef, runTaskChainRef],
          },
          guiAskUser: {
            source: 'gui.ask_user:run-no-risk-audit:computer-use',
            approvalRequest: {
              id: 'approval:computer-use:no-risk-audit',
              risk_level: 'high',
              action_kind: 'external-send',
            },
            relatedRefs: [traceRef],
          },
          displayIntent: {
            conversationProjection: {
              visibleAnswer: {
                status: 'needs-human',
                artifactRefs: [traceRef, runTaskChainRef],
              },
              artifacts: [{ ref: traceRef }, { ref: runTaskChainRef }],
              auditRefs: [runTaskChainRef],
            },
          },
        },
      },
    },
  });

  assert.equal(manifest.status, 'failed');
  assert.ok(manifest.issues.includes('needs-confirmation-missing-risk-audit-ref'));
});

test('Computer Use chat live continuation E2E reuses repair sidecar refs in second request and events', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-continuation-refs-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstTraceRef = '.sciforge/vision-runs/cu-repair-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair-round-1/continuation-request.json';
  const runTaskChainRef = '.sciforge/vision-runs/cu-repair-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-repair-round-2/vision-trace.json';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-repair-round-2/tui-host-run-task-chain.json';
  try {
    await writeJson(join(workspace, blockedManifestRef), {
      schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
      status: 'blocked',
      reason: 'First turn could not materialize a visible report under read-only constraints.',
      continuationRequestRef,
    });
    await writeJson(join(workspace, repairHintRef), {
      schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
      status: 'repair-needed',
      reason: 'Retry with one safe visible local artifact action.',
      nextAttempt: {
        reuseTraceRef: firstTraceRef,
        reuseRunTaskChainRef: runTaskChainRef,
        requireFreshObservation: true,
        preserveInputIsolation: true,
      },
    });
    await writeJson(join(workspace, continuationRequestRef), {
      schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
      status: 'ready-for-continuation',
      blockedManifestRef,
      repairHintRef,
      sameTraceSessionRef: runTaskChainRef,
    });

    const manifest = await runComputerUseChatLiveContinuationE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use continuation result' : 'Computer Use repair result',
                      status: 'repair-needed',
                      message: isSecond
                        ? 'Computer Use continued with prior repair refs and still needs one more visible step.'
                        : 'Computer Use wrote repair sidecars for continuation.',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: [runTaskChainRef, ...(isSecond ? [secondRunTaskChainRef] : [])],
                    },
                  }],
                },
              },
            },
            { result: { status: 'repair-needed', message: 'Computer Use repair needed.', executionUnits: [], artifacts: [] } },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.match(String(bodies[1]?.prompt), /^\/computer-use continue --continuation-request-ref/);
    assert.match(JSON.stringify(bodies[1]), /continuation-request\.json/);
    assert.match(JSON.stringify(bodies[1]), /repair-hint\.json/);
    assert.match(JSON.stringify(bodies[1]), /blocked-manifest\.json/);
    assert.match(JSON.stringify(bodies[1]), /tui-host-run-task-chain\.json/);
    assert.match(JSON.stringify(bodies[1]), /Retry with one safe visible local artifact action/);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    assert.equal(manifest.requestSubmitted, true);
    assert.deepEqual(manifest.issues, []);
    assert.equal(manifest.continuation.continuationRequestRef, continuationRequestRef);
    assert.deepEqual(manifest.continuation.requestEvidence, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: true,
    });
    assert.deepEqual(manifest.continuation.eventEvidence, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: true,
    });
    assert.ok(manifest.continuation.secondEventRefs.includes(secondRunTaskChainRef));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live continuation E2E accepts repair-needed then completed only with current-run bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-continuation-completed-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstTraceRef = '.sciforge/vision-runs/cu-repair-completed-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair-completed-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair-completed-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair-completed-round-1/continuation-request.json';
  const firstRunTaskChainRef = '.sciforge/vision-runs/cu-repair-completed-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
  const finalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
  const secondComputerUseRequestRef = '.sciforge/vision-runs/cu-next-07-wrapper/computer-use-request.json';
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    await writeContinuationRepairSidecars(workspace, {
      firstTraceRef,
      blockedManifestRef,
      repairHintRef,
      continuationRequestRef,
      firstRunTaskChainRef,
    });

    const manifest = await runComputerUseChatLiveContinuationE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      secondExpectedStatus: 'completed',
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          if (isSecond) {
            await writeContinuationComputerUseRequest(workspace, {
              computerUseRequestRef: secondComputerUseRequestRef,
              runTaskChainRef: secondRunTaskChainRef,
              blockedManifestRef,
              repairHintRef,
              continuationRequestRef,
              firstTraceRef,
              firstRunTaskChainRef,
            });
          }
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use continuation completed' : 'Computer Use repair result',
                      status: isSecond ? 'completed' : 'repair-needed',
                      message: isSecond
                        ? 'Computer Use completed after carrying prior repair refs into the continuation.'
                        : 'Computer Use wrote repair sidecars for continuation.',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      artifactRefs: isSecond ? [finalArtifactRef] : [],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: isSecond
                        ? [secondRunTaskChainRef, firstRunTaskChainRef]
                        : [firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'repair-needed',
                message: isSecond ? 'Computer Use completed.' : 'Computer Use repair needed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(manifest.status, 'passed', JSON.stringify(manifest.issues));
    assert.equal(manifest.requestSubmitted, true);
    assert.equal(manifest.liveAcceptanceCandidate, true);
    assert.deepEqual(manifest.issues, []);
    assert.equal(manifest.secondTurn?.status, 'completed');
    assert.equal(manifest.secondTurn?.liveAcceptanceCandidate, true);
    assert.equal(manifest.secondTurn?.liveAcceptanceBundle?.status, 'valid');
    assert.equal(manifest.secondTurn?.liveAcceptanceBundle?.acceptanceManifestRef, '.sciforge/vision-runs/cu-next-07-wrapper/cu-user-acceptance-manifest.json');
    assert.equal(manifest.secondTurn?.packageBridgeCompletionGrade?.status, 'attached');
    assert.equal(manifest.continuation.completedGate?.firstRepairSidecarPayloadHydrated, true);
    assert.equal(manifest.continuation.completedGate?.currentRunBundle?.status, 'valid');
    assert.equal(
      manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.acceptanceFinalArtifactRef,
      finalArtifactRef,
    );
    assert.equal(manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.consistent, true);
    assert.deepEqual(manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.matchingFinalArtifactRefs, [finalArtifactRef]);
    assert.deepEqual(manifest.continuation.sidecarHydration.requestSidecars, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: false,
    });
    assert.deepEqual(manifest.continuation.sidecarHydration.plannerMetadataSidecars, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: false,
    });
    assert.deepEqual(manifest.continuation.sidecarHydration.secondActionProviderRequestRefs, [secondComputerUseRequestRef]);
    assert.match(JSON.stringify(manifest.continuation.sidecarHydration.whitelistedSummary), /Retry with one safe visible local artifact action/);
    assert.doesNotMatch(JSON.stringify(manifest.continuation.sidecarHydration.whitelistedSummary), /privateHugeField|must not leak/);
    assert.match(JSON.stringify(bodies[1]), /continuation-request\.json/);
    assert.match(JSON.stringify(bodies[1]), /repair-hint\.json/);
    assert.match(JSON.stringify(bodies[1]), /blocked-manifest\.json/);
    assert.match(JSON.stringify(bodies[1]), /tui-host-run-task-chain\.json/);
    assert.match(String(bodies[1]?.prompt), /visible local report artifact/);
    assert.match(String(bodies[1]?.prompt), /current run has a visible final artifact ref/);
    assert.deepEqual(manifest.continuation.requestEvidence, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: true,
    });
    assert.deepEqual(manifest.continuation.eventEvidence, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: true,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live continuation E2E ignores pseudo final artifact refs when current-run artifact is consistent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-continuation-pseudo-final-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstTraceRef = '.sciforge/vision-runs/cu-repair-pseudo-final-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair-pseudo-final-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair-pseudo-final-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair-pseudo-final-round-1/continuation-request.json';
  const firstRunTaskChainRef = '.sciforge/vision-runs/cu-repair-pseudo-final-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
  const finalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
  const secondComputerUseRequestRef = '.sciforge/vision-runs/cu-next-07-wrapper/computer-use-request.json';
  const pseudoRefs = [
    'EU-cu-next-07-final-artifact',
    'workEvidence:computer-use-action-provider:cu-next-07',
    'artifact:cu-next-07-wrapper/dense-grounding-export.csv',
  ];
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    await writeContinuationRepairSidecars(workspace, {
      firstTraceRef,
      blockedManifestRef,
      repairHintRef,
      continuationRequestRef,
      firstRunTaskChainRef,
    });

    const manifest = await runComputerUseChatLiveContinuationE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      secondExpectedStatus: 'completed',
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          if (isSecond) {
            await writeContinuationComputerUseRequest(workspace, {
              computerUseRequestRef: secondComputerUseRequestRef,
              runTaskChainRef: secondRunTaskChainRef,
              blockedManifestRef,
              repairHintRef,
              continuationRequestRef,
              firstTraceRef,
              firstRunTaskChainRef,
            });
          }
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use continuation completed' : 'Computer Use repair result',
                      status: isSecond ? 'completed' : 'repair-needed',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      displayedRefs: isSecond ? [finalArtifactRef] : [],
                      artifactRefs: isSecond ? [...pseudoRefs, finalArtifactRef] : [],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: isSecond ? [secondRunTaskChainRef, firstRunTaskChainRef] : [firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'repair-needed',
                message: isSecond ? 'Computer Use completed.' : 'Computer Use repair needed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
    assert.deepEqual(manifest.issues, []);
    assert.deepEqual(manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.secondTurnFinalArtifactRefs, [finalArtifactRef]);
    assert.deepEqual(
      manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.rejectedFinalArtifactRefs.map((item) => item.ref),
      pseudoRefs,
    );
    assert.equal(manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.consistent, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live continuation E2E rejects completed when repair sidecars are only string refs', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-continuation-string-only-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstTraceRef = '.sciforge/vision-runs/cu-repair-string-only-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair-string-only-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair-string-only-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair-string-only-round-1/continuation-request.json';
  const firstRunTaskChainRef = '.sciforge/vision-runs/cu-repair-string-only-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
  const finalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    await writeContinuationRepairSidecars(workspace, {
      firstTraceRef,
      blockedManifestRef,
      repairHintRef,
      continuationRequestRef,
      firstRunTaskChainRef,
    });

    const manifest = await runComputerUseChatLiveContinuationE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      secondExpectedStatus: 'completed',
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use continuation completed' : 'Computer Use repair result',
                      status: isSecond ? 'completed' : 'repair-needed',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      artifactRefs: isSecond ? [finalArtifactRef] : [],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: isSecond
                        ? [secondRunTaskChainRef, firstRunTaskChainRef]
                        : [firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'repair-needed',
                message: isSecond ? 'Computer Use completed.' : 'Computer Use repair needed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.secondTurn?.liveAcceptanceBundle?.status, 'valid');
    assert.deepEqual(manifest.continuation.sidecarHydration.requestSidecars, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: false,
    });
    assert.ok(manifest.issues.includes('second-completed-missing-computer-use-request-ref'));
    assert.ok(manifest.issues.includes('second-planner-metadata-missing-hydrated-repair-hint.json'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live continuation E2E rejects completed final artifact refs that do not match gui.present and current-run bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-continuation-artifact-mismatch-'));
  const bodies: Array<Record<string, unknown>> = [];
  const firstTraceRef = '.sciforge/vision-runs/cu-repair-artifact-mismatch-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair-artifact-mismatch-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair-artifact-mismatch-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair-artifact-mismatch-round-1/continuation-request.json';
  const firstRunTaskChainRef = '.sciforge/vision-runs/cu-repair-artifact-mismatch-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json';
  const acceptanceFinalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/dense-grounding-export.csv';
  const wrongFinalArtifactRef = '.sciforge/vision-runs/cu-next-07-wrapper/wrong-report.csv';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-next-07-wrapper/tui-host-run-task-chain.json';
  const secondComputerUseRequestRef = '.sciforge/vision-runs/cu-next-07-wrapper/computer-use-request.json';
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    await writeContinuationRepairSidecars(workspace, {
      firstTraceRef,
      blockedManifestRef,
      repairHintRef,
      continuationRequestRef,
      firstRunTaskChainRef,
    });

    const manifest = await runComputerUseChatLiveContinuationE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      secondExpectedStatus: 'completed',
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          if (isSecond) {
            await writeContinuationComputerUseRequest(workspace, {
              computerUseRequestRef: secondComputerUseRequestRef,
              runTaskChainRef: secondRunTaskChainRef,
              blockedManifestRef,
              repairHintRef,
              continuationRequestRef,
              firstTraceRef,
              firstRunTaskChainRef,
            });
          }
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use continuation completed' : 'Computer Use repair result',
                      status: isSecond ? 'completed' : 'repair-needed',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      artifactRefs: isSecond ? [wrongFinalArtifactRef] : [],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: isSecond
                        ? [secondRunTaskChainRef, firstRunTaskChainRef]
                        : [firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'repair-needed',
                message: isSecond ? 'Computer Use completed.' : 'Computer Use repair needed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.secondTurn?.liveAcceptanceBundle?.status, 'valid');
    assert.equal(manifest.continuation.completedGate?.firstRepairSidecarPayloadHydrated, true);
    assert.equal(manifest.continuation.completedGate?.currentRunBundle?.status, 'valid');
    assert.equal(manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.consistent, false);
    assert.deepEqual(manifest.continuation.completedGate?.finalArtifactGuiPresentRefs.matchingFinalArtifactRefs, []);
    assert.ok(manifest.issues.includes(`second-completed-final-artifact-missing-from-second-turn-artifacts:${acceptanceFinalArtifactRef}`));
    assert.ok(manifest.issues.includes(`second-completed-final-artifact-missing-from-gui-present-displayed-refs:${acceptanceFinalArtifactRef}`));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live continuation E2E rejects second-turn completed without current-run bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-continuation-no-bundle-'));
  const firstTraceRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-1/vision-trace.json';
  const blockedManifestRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-1/blocked-manifest.json';
  const repairHintRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-1/repair-hint.json';
  const continuationRequestRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-1/continuation-request.json';
  const firstRunTaskChainRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-1/tui-host-run-task-chain.json';
  const secondTraceRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-2/vision-trace.json';
  const finalArtifactRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-2/report.md';
  const secondRunTaskChainRef = '.sciforge/vision-runs/cu-repair-missing-bundle-round-2/tui-host-run-task-chain.json';
  const bodies: Array<Record<string, unknown>> = [];
  try {
    const manifest = await runComputerUseChatLiveContinuationE2E({
      env: { ...readyEnv(), SCIFORGE_WORKSPACE_PATH: workspace },
      workspacePath: workspace,
      localConfigs: [],
      secondExpectedStatus: 'completed',
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/api/sciforge/tools/run/stream')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          bodies.push(body);
          const commandId = String((body.uiState as Record<string, unknown>).commandId);
          const isSecond = bodies.length === 2;
          return ndjsonResponse([
            {
              event: {
                type: 'computer-use.tui-host-actions',
                source: 'computer-use-package-bridge',
                commandId,
                attemptId: `${commandId}-attempt-1`,
                detail: {
                  actions: [{
                    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
                    port: 'gui.present',
                    target: 'computer-use.trace-summary',
                    payload: {
                      title: isSecond ? 'Computer Use continuation completed' : 'Computer Use repair result',
                      status: isSecond ? 'completed' : 'repair-needed',
                      message: isSecond
                        ? 'Computer Use claimed completion after continuation.'
                        : 'Computer Use wrote repair sidecars for continuation.',
                      traceRefs: [isSecond ? secondTraceRef : firstTraceRef],
                      artifactRefs: isSecond ? [finalArtifactRef] : [],
                      blockedManifestRefs: [blockedManifestRef],
                      repairHintRefs: [repairHintRef],
                      continuationRequestRefs: [continuationRequestRef],
                      runTaskChainRefs: isSecond
                        ? [secondRunTaskChainRef, firstRunTaskChainRef]
                        : [firstRunTaskChainRef],
                    },
                  }],
                },
              },
            },
            {
              result: {
                status: isSecond ? 'completed' : 'repair-needed',
                message: isSecond ? 'Computer Use completed.' : 'Computer Use repair needed.',
                executionUnits: [],
                artifacts: [],
              },
            },
          ]);
        }
        return readyServiceResponse(url);
      },
    });

    assert.equal(bodies.length, 2);
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.liveAcceptanceCandidate, false);
    assert.equal(manifest.secondTurn?.status, 'failed');
    assert.equal(manifest.secondTurn?.liveAcceptanceBundle?.status, 'missing');
    assert.ok(manifest.issues.includes('second-completed-live-acceptance-bundle-missing'));
    assert.ok(manifest.issues.some((issue) => issue.includes('cu-user-acceptance-manifest.json is missing')));
    assert.ok(manifest.secondTurn?.failureDiagnostics.some((diagnostic) => diagnostic.kind === 'canonical-l3-missing'));
    assert.ok(manifest.continuation.completedGate?.diagnostics.some((diagnostic) => (
      diagnostic.kind === 'missing-current-run-bundle'
      && diagnostic.summary.includes('missing')
    )));
    assert.deepEqual(manifest.continuation.requestEvidence, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: true,
    });
    assert.deepEqual(manifest.continuation.eventEvidence, {
      continuationRequest: true,
      repairHint: true,
      blockedManifest: true,
      runTaskChain: true,
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle rejects missing current-run manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-missing-bundle-'));
  try {
    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: ['.sciforge/vision-runs/missing/vision-trace.json'],
    });

    assert.equal(result.status, 'missing');
    assert.ok(result.issues.some((issue) => issue.includes('cu-user-acceptance-manifest.json is missing')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle normalizes current-run-prefixed refs inside manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-current-run-ref-bundle-'));
  try {
    const manifestPath = await writeBundleLocalCuNext07Acceptance(workspace);
    await writeFile(manifestPath, `${JSON.stringify(passedCuNext07AcceptanceManifest(), null, 2)}\n`);

    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: ['.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json'],
    });

    assert.equal(result.status, 'valid', result.issues.join('\n'));
    assert.equal(result.runDirRef, '.sciforge/vision-runs/cu-next-07-wrapper');
    assert.equal(result.completionEvidenceRef, 'isolated-desktop-l3-workflow-evidence.json');
    assert.deepEqual(result.missingRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle rejects symlinked completion evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-symlink-bundle-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);
    const completionPath = join(workspace, '.sciforge/vision-runs/cu-next-07-wrapper/isolated-desktop-l3-workflow-evidence.json');
    await rm(completionPath, { force: true });
    await symlink(join(workspace, 'outside-isolated-desktop-l3-workflow-evidence.json'), completionPath);

    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: ['.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json'],
    });

    assert.equal(result.status, 'invalid');
    assert.ok(result.issues.some((issue) => issue.includes('completionEvidenceRef isolated-desktop-l3-workflow-evidence.json could not be loaded')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle ignores old manifest paths outside the current run dir', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-old-bundle-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);

    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: [
        '.sciforge/vision-runs/current-run/vision-trace.json',
        '.sciforge/vision-runs/cu-next-07-wrapper/cu-user-acceptance-manifest.json',
      ],
    });

    assert.equal(result.status, 'missing');
    assert.equal(result.acceptanceManifestRef, '.sciforge/vision-runs/current-run/cu-user-acceptance-manifest.json');
    assert.ok(result.issues.some((issue) => issue.includes('current-run/cu-user-acceptance-manifest.json is missing')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle rejects artifact refs for canonical completion evidence', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-artifact-ref-'));
  try {
    const manifestPath = await writeBundleLocalCuNext07Acceptance(workspace);
    const acceptance = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    acceptance.completionEvidenceRef = 'artifact:isolated-desktop-l3-workflow-evidence.json';
    await writeFile(manifestPath, `${JSON.stringify(acceptance, null, 2)}\n`);

    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: ['.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json'],
    });

    assert.equal(result.status, 'invalid');
    assert.ok(result.issues.some((issue) => issue.includes('completionEvidenceRef must be the same-round bundle-local isolated-desktop-l3-workflow-evidence.json')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle rejects readiness manifest in the completed manifest slot', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-readiness-manifest-'));
  try {
    const manifestPath = join(workspace, '.sciforge/vision-runs/current-run/cu-user-acceptance-manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 'sciforge.computer-use.cu-next-readiness.v1',
      status: 'ready',
      completionEligible: true,
    }, null, 2)}\n`);

    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: ['.sciforge/vision-runs/current-run/vision-trace.json'],
    });

    assert.equal(result.status, 'invalid');
    assert.ok(result.issues.some((issue) => issue.includes('is not a CU user acceptance manifest')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live acceptance bundle rejects artifact pseudo refs as current run anchors', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-chat-live-artifact-anchor-'));
  try {
    await writeBundleLocalCuNext07Acceptance(workspace);

    const result = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath: workspace,
      refs: ['artifact:.sciforge/vision-runs/cu-next-07-wrapper/vision-trace.json'],
    });

    assert.equal(result.status, 'missing');
    assert.ok(result.issues.some((issue) => issue.includes('current Computer Use run dir could not be inferred')));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function writeNeedsConfirmationSidecars(workspace: string, input: {
  traceRef: string;
  screenshotRef: string;
  runTaskChainRef: string;
  directoryListingRef: string;
  approvalRequestRef: string;
  guiAskUserRecordRef: string;
  riskAuditRef: string;
  approvalRef: string;
  approvalRequestId: string;
  riskActionHash: string;
  approvalRequest: Record<string, unknown>;
}): Promise<void> {
  await writeJson(join(workspace, input.runTaskChainRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
    refs: {
      traceRef: input.traceRef,
      guiAskUserRecordRef: input.guiAskUserRecordRef,
      approvalRequestRef: input.approvalRequestRef,
      riskAuditRef: input.riskAuditRef,
      directoryListingRef: input.directoryListingRef,
    },
  });
  await writeJson(join(workspace, input.directoryListingRef), {
    schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
    fileRefs: [
      input.traceRef,
      input.screenshotRef,
      input.runTaskChainRef,
      input.guiAskUserRecordRef,
      input.approvalRequestRef,
      input.riskAuditRef,
    ],
  });
  await writeJson(join(workspace, input.approvalRequestRef), {
    schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    approvalRequest: input.approvalRequest,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  await writeJson(join(workspace, input.guiAskUserRecordRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
    port: 'gui.ask_user',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    payload: { approvalRequest: input.approvalRequest },
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  await writeJson(join(workspace, input.riskAuditRef), {
    schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    highRiskAction: { actionKind: 'external-send', targetDescription: 'drafted external email send control' },
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
}

function priorNeedsConfirmationRun(input: {
  approvalRef: string;
  approvalRequest: Record<string, unknown>;
  priorRunDir: string;
}): SciForgeRun {
  const traceRef = `${input.priorRunDir}/vision-trace.json`;
  const approvalRequestRef = `${input.priorRunDir}/approval-request.json`;
  const guiAskUserRecordRef = `${input.priorRunDir}/gui-ask-user.json`;
  const riskAuditRef = `${input.priorRunDir}/risk-audit.json`;
  return {
    id: 'run-chat-live-risk-needs-confirmation',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: '/computer-use guarded smoke',
    response: 'needs confirmation',
    createdAt: '2026-05-29T00:00:00.000Z',
    raw: {
      guiPresentation: {
        source: 'gui.present:run-chat-live-risk-needs-confirmation:computer-use',
        displayedRefs: [traceRef, approvalRequestRef, guiAskUserRecordRef, riskAuditRef],
      },
      guiAskUser: {
        source: 'gui.ask_user:run-chat-live-risk-needs-confirmation:computer-use',
        approvalRequest: input.approvalRequest,
        relatedRefs: [traceRef, approvalRequestRef, guiAskUserRecordRef, riskAuditRef],
      },
      displayIntent: {
        conversationProjection: {
          auditRefs: [riskAuditRef],
          artifacts: [{ ref: approvalRequestRef }, { ref: guiAskUserRecordRef }],
        },
      },
    },
  };
}

async function writeConfirmedApprovalSidecars(workspace: string, input: {
  traceRef: string;
  runTaskChainRef: string;
  directoryListingRef: string;
  confirmedRequestRef: string;
  approvalDecisionRef: string;
  sourceApprovalRequestRef: string;
  sourceGuiAskUserRecordRef: string;
  sourceRiskAuditRef: string;
  riskAuditRef: string;
  approvalRef: string;
  approvalRequestId: string;
  riskActionHash: string;
}): Promise<void> {
  const approvalRequest = {
    id: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    riskLevel: 'high',
    actionKind: 'external-send',
  };
  const sourceRefs = {
    sourceApprovalRequestRef: input.sourceApprovalRequestRef,
    sourceGuiAskUserRecordRef: input.sourceGuiAskUserRecordRef,
    sourceRiskAuditRef: input.sourceRiskAuditRef,
  };
  const confirmedRefs = {
    confirmedRequestRef: input.confirmedRequestRef,
    approvalDecisionRef: input.approvalDecisionRef,
    ...sourceRefs,
  };
  await writeJson(join(workspace, input.runTaskChainRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
    refs: input,
  });
  await writeJson(join(workspace, input.directoryListingRef), {
    schemaVersion: 'sciforge.computer-use.evidence-directory-listing.v1',
    fileRefs: [
      input.traceRef,
      input.runTaskChainRef,
      input.confirmedRequestRef,
      input.approvalDecisionRef,
      input.sourceApprovalRequestRef,
      input.sourceGuiAskUserRecordRef,
      input.sourceRiskAuditRef,
      input.riskAuditRef,
    ],
  });
  await writeJson(join(workspace, input.sourceApprovalRequestRef), {
    schemaVersion: 'sciforge.computer-use.approval-request-sidecar.v1',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    approvalRequest,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  await writeJson(join(workspace, input.sourceGuiAskUserRecordRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-actions.v1',
    port: 'gui.ask_user',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    payload: { approvalRequest },
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  await writeJson(join(workspace, input.sourceRiskAuditRef), {
    schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1',
    status: 'needs-confirmation',
    approvalRequestId: input.approvalRequestId,
    approvalRef: input.approvalRef,
    riskActionHash: input.riskActionHash,
    deniedExecuted: false,
    packageMayCallGuiDirectly: false,
  });
  for (const [ref, extra] of [
    [input.confirmedRequestRef, { schemaVersion: 'sciforge.computer-use.confirmed-request-sidecar.v1' }],
    [input.approvalDecisionRef, { schemaVersion: 'sciforge.computer-use.approval-decision-sidecar.v1', decision: 'approved' }],
    [input.riskAuditRef, { schemaVersion: 'sciforge.computer-use.risk-audit-sidecar.v1', highRiskAction: { actionKind: 'external-send' } }],
  ] as const) {
    await writeJson(join(workspace, ref), {
      ...extra,
      status: 'confirmed',
      approvalRequestId: input.approvalRequestId,
      approvalRef: input.approvalRef,
      riskActionHash: input.riskActionHash,
      ...confirmedRefs,
      deniedExecuted: false,
      packageMayCallGuiDirectly: false,
    });
  }
}

async function writeContinuationRepairSidecars(workspace: string, input: {
  firstTraceRef: string;
  blockedManifestRef: string;
  repairHintRef: string;
  continuationRequestRef: string;
  firstRunTaskChainRef: string;
}): Promise<void> {
  await writeJson(join(workspace, input.blockedManifestRef), {
    schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
    status: 'blocked',
    reason: 'First turn could not materialize a visible report under read-only constraints.',
    failedStage: 'visible-artifact-final-guard',
    continuationRequestRef: input.continuationRequestRef,
    privateHugeField: 'must not leak',
  });
  await writeJson(join(workspace, input.repairHintRef), {
    schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
    status: 'repair-needed',
    reason: 'Retry with one safe visible local artifact action.',
    nextAttempt: {
      reuseTraceRef: input.firstTraceRef,
      reuseRunTaskChainRef: input.firstRunTaskChainRef,
      requireFreshObservation: true,
      preserveInputIsolation: true,
      privateHugeField: 'must not leak',
    },
  });
  await writeJson(join(workspace, input.continuationRequestRef), {
    schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
    status: 'ready-for-continuation',
    blockedManifestRef: input.blockedManifestRef,
    repairHintRef: input.repairHintRef,
    sameTraceSessionRef: input.firstRunTaskChainRef,
  });
}

async function writeContinuationComputerUseRequest(workspace: string, input: {
  computerUseRequestRef: string;
  runTaskChainRef: string;
  blockedManifestRef: string;
  repairHintRef: string;
  continuationRequestRef: string;
  firstTraceRef: string;
  firstRunTaskChainRef: string;
}): Promise<void> {
  const sidecars = continuationWhitelistedSidecars(input);
  const runDirRef = input.runTaskChainRef.replace(/\/tui-host-run-task-chain\.json$/, '');
  const acceptanceManifestRef = `${runDirRef}/cu-user-acceptance-manifest.json`;
  const completionEvidenceRef = `${runDirRef}/isolated-desktop-l3-workflow-evidence.json`;
  const directoryListingRef = `${runDirRef}/directory-listing.json`;
  await writeJson(join(workspace, input.computerUseRequestRef), {
    schemaVersion: 'sciforge.computer-use.request.v1',
    task: '/computer-use continue --continuation-request-ref',
    metadata: {
      plannerAcceptanceContract: {
        schemaVersion: 'sciforge.computer-use.planner-acceptance-contract.v1',
        computerUseContinuation: {
          schemaVersion: 'sciforge.computer-use.continuation-context.v1',
          source: 'gateway-request-references',
          blockedManifestRefs: [input.blockedManifestRef],
          repairHintRefs: [input.repairHintRef],
          continuationRequestRefs: [input.continuationRequestRef],
          runTaskChainRefs: [input.firstRunTaskChainRef],
          sidecars,
        },
      },
    },
  });
  await writeJson(join(workspace, input.runTaskChainRef), {
    schemaVersion: 'sciforge.computer-use.tui-host-run-task-chain.v1',
    refs: {
      requestRef: input.computerUseRequestRef,
      blockedManifestRef: input.blockedManifestRef,
      repairHintRef: input.repairHintRef,
      continuationRequestRef: input.continuationRequestRef,
      runTaskChainRef: input.firstRunTaskChainRef,
      directoryListingRef,
      acceptanceManifestRef,
      completionEvidenceRef,
    },
    links: [
      { kind: 'directory-listing', status: 'present', recordRef: directoryListingRef },
      { kind: 'user-acceptance-manifest', status: 'present', recordRef: acceptanceManifestRef },
      { kind: 'completion-grade-evidence', status: 'attached', recordRef: completionEvidenceRef },
    ],
    completionGrade: {
      status: 'attached',
      acceptanceManifestRef,
      completionEvidenceRef,
    },
  });
}

function continuationWhitelistedSidecars(input: {
  blockedManifestRef: string;
  repairHintRef: string;
  continuationRequestRef: string;
  firstTraceRef: string;
  firstRunTaskChainRef: string;
}) {
  return {
    blockedManifest: {
      schemaVersion: 'sciforge.computer-use.blocked-manifest-sidecar.v1',
      status: 'blocked',
      reason: 'First turn could not materialize a visible report under read-only constraints.',
      failedStage: 'visible-artifact-final-guard',
      continuationRequestRef: input.continuationRequestRef,
    },
    repairHint: {
      schemaVersion: 'sciforge.computer-use.repair-hint-sidecar.v1',
      status: 'repair-needed',
      reason: 'Retry with one safe visible local artifact action.',
      nextAttempt: {
        reuseTraceRef: input.firstTraceRef,
        reuseRunTaskChainRef: input.firstRunTaskChainRef,
        requireFreshObservation: true,
        preserveInputIsolation: true,
      },
    },
    continuationRequest: {
      schemaVersion: 'sciforge.computer-use.continuation-request-sidecar.v1',
      status: 'ready-for-continuation',
      blockedManifestRef: input.blockedManifestRef,
      repairHintRef: input.repairHintRef,
      sameTraceSessionRef: input.firstRunTaskChainRef,
    },
  };
}

function readyEnv(): NodeJS.ProcessEnv {
  return {
    SCIFORGE_RUNTIME_API_KEY: 'sk-live-secret',
    SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example/v1',
    SCIFORGE_VISION_DESKTOP_BRIDGE: '1',
    SCIFORGE_VISION_INPUT_ADAPTER: 'remote-desktop',
    SCIFORGE_VISION_INDEPENDENT_INPUT_ADAPTER_PROVIDER: 'sciforge-simulated-remote-desktop',
    SCIFORGE_VISION_KV_GROUND_URL: 'http://127.0.0.1:18081',
    SCIFORGE_UI_URL: 'http://127.0.0.1:5173/',
    SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:6173/health',
    SCIFORGE_RUNTIME_CODEX_URL: 'http://127.0.0.1:18080/health',
    SCIFORGE_PROXY_URL: 'http://127.0.0.1:3891/healthz',
    SCIFORGE_WORKSPACE_PATH: '/tmp/current',
  };
}

function readyPreflight() {
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-preflight.v1' as const,
    checkedAt: '2026-05-29T00:00:00.000Z',
    status: 'ready' as const,
    releaseAcceptance: 'not-evaluated' as const,
    evidenceMode: 'current-env-diagnostic-only' as const,
    requiredEnv: [],
    localConfigSources: [],
    missingEnv: [],
    policyViolations: [],
    requestConfigAssumptions: {},
    serviceChecks: [],
    runtimeProviderPreflight: {
      status: 'ready' as const,
      category: 'ready',
      runtimeApiKeyPresentInServiceEnv: true,
      upstreamBaseUrlPresent: true,
      upstreamKeySourceKind: 'env',
      upstreamBaseUrlSourceKind: 'env',
      missingEnv: [],
      policyViolations: [],
      evidenceMode: 'current-env-diagnostic-only',
      releaseAcceptance: 'not-evaluated',
      checkedHealthz: { category: 'ready', ok: true, httpStatus: 200 },
      valuePrinted: false as const,
    },
    suggestedSmokePrompt: '/computer-use read-only smoke',
    expectedEvidenceRefs: [],
    nextActions: [],
  };
}

function readyServiceResponse(url: string): Response {
  if (url.includes('/api/sciforge/runtime-provider-preflight/manifest')) {
    return jsonResponse({
      ok: true,
      manifest: {
        schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
        releaseAcceptance: 'not-evaluated',
        evidenceMode: 'current-env-diagnostic-only',
        category: 'ready',
        runtimeApiKeyPresentInServiceEnv: true,
        upstreamBaseUrlPresent: true,
        upstreamKeySourceKind: 'env',
        upstreamBaseUrlSourceKind: 'env',
        missingEnv: [],
        policyViolations: [],
        checkedHealthz: { category: 'ready', ok: true, httpStatus: 200 },
      },
    });
  }
  if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
  if (url.endsWith('/health')) return jsonResponse({ ok: true, ready: true });
  return htmlResponse('<!doctype html><html><body>SciForge</body></html>');
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

function ndjsonResponse(items: unknown[]) {
  return new Response(`${items.map((item) => JSON.stringify(item)).join('\n')}\n`, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

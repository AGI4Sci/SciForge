import test from 'node:test';
import assert from 'node:assert/strict';
import type { SendAgentMessageInput } from '../../domain';
import {
  buildComputerUseWorkspaceGatewayRequest,
  computerUseTerminalEquivalentTextRequested,
  computerUseWorkspaceGatewayDiagnosticRequested,
  sanitizedComputerUseTaskBindings,
} from './computerUseWorkspaceGatewayRequest';
import { runtimeRequestInput } from './runtimeEvents.testHelpers';

test('Computer Use GUI affordances stay terminal-equivalent text by default', () => {
  assert.equal(computerUseTerminalEquivalentTextRequested(runtimeRequestInput()), false);
  assert.equal(computerUseTerminalEquivalentTextRequested({
    ...runtimeRequestInput(),
    prompt: '/computer-use inspect the visible browser',
  }), true);
  assert.equal(computerUseTerminalEquivalentTextRequested({
    ...runtimeRequestInput(),
    scenarioOverride: {
      ...runtimeRequestInput().scenarioOverride!,
      selectedToolIds: ['action.sciforge.computer-use'],
    },
  }), true);
  assert.equal(computerUseWorkspaceGatewayDiagnosticRequested({
    ...runtimeRequestInput(),
    prompt: '/computer-use inspect the visible browser',
  }), false);
  assert.equal(computerUseWorkspaceGatewayDiagnosticRequested({
    ...runtimeRequestInput(),
    prompt: '/computer-use diagnostic --legacy-workspace-gateway inspect refs',
  }), true);
});

test('buildComputerUseWorkspaceGatewayRequest creates only a legacy diagnostic shim', () => {
  const traceRef = '.sciforge/vision-runs/cu-risk/vision-trace.json';
  const approvalRef = 'approval:computer-use:cu-risk';
  const input: SendAgentMessageInput = {
    ...runtimeRequestInput(),
    prompt: `/computer-use diagnostic --legacy-workspace-gateway approve --approval-ref "${approvalRef}"`,
    currentTurnId: 'turn-cu-approval',
    scenarioOverride: {
      ...runtimeRequestInput().scenarioOverride!,
      selectedToolIds: ['local.vision-sense', 'custom.tool'],
      selectedSenseIds: ['custom.sense'],
      selectedActionIds: ['custom.action'],
      completionEvidencePolicy: {
        schemaVersion: 'sciforge.completion-evidence-policy.v1',
        producers: [{
          id: 'computer-use.embedded-isolated-desktop-l3',
          enabled: true,
          trigger: 'on-completed-current-run',
          ignoredExtra: true,
        }, {
          id: 'unrelated',
          enabled: true,
          trigger: 'on-completed-current-run',
        }],
      },
      computerUseNext: {
        taskId: 'CU-NEXT-01',
        scenarioId: 'CU-LONG-001',
        title: 'Briefing deck',
        requirements: ['refs-first-evidence-bundle', ''],
        safetyBoundary: {
          noDomAccessibility: true,
          secretFlag: 'SECRET_NEXT_BOUNDARY_SHOULD_NOT_LEAK',
        },
        secret: 'SECRET_NEXT_SHOULD_NOT_LEAK',
      },
      computerUseLong: {
        taskId: 'CU-NEXT-01',
        cuNextTaskId: 'CU-NEXT-01',
        scenarioId: 'CU-LONG-001',
        title: 'Briefing deck',
        requiredEvidence: ['cu-user-acceptance-manifest.json'],
        safetyBoundary: {
          noDomAccessibility: true,
          secretFlag: 'SECRET_LONG_SHOULD_NOT_LEAK',
        },
      },
    },
    runs: [{
      id: 'run-needs-approval',
      raw: {
        guiPresentation: {
          source: 'gui.present:run-needs-approval:computer-use',
          displayedRefs: [traceRef],
        },
        guiAskUser: {
          source: 'gui.ask_user:run-needs-approval:computer-use',
          approvalRequest: {
            id: approvalRef,
            prompt: 'Allow click?',
          },
          relatedRefs: [traceRef],
        },
        riskAuditSidecar: {
          riskActionHash: 'risk-hash-1',
          highRiskAction: { kind: 'click', target: 'Submit' },
        },
        displayIntent: {
          conversationProjection: {
            auditRefs: ['.sciforge/vision-runs/cu-risk/risk-audit.json'],
            artifacts: [{ ref: '.sciforge/vision-runs/cu-risk/gui-ask-user.json' }],
          },
        },
      },
    } as NonNullable<SendAgentMessageInput['runs']>[number]],
  };

  const request = buildComputerUseWorkspaceGatewayRequest(input, 'computer-use-command-test');
  const requestRecord = request as Record<string, unknown>;
  const uiState = request.uiState as Record<string, unknown>;
  const humanApproval = request.humanApproval as Record<string, unknown>;
  const provenance = humanApproval.approvalProvenance as Record<string, unknown>;

  assert.equal(request.schemaVersion, 'sciforge.computer-use.legacy-workspace-gateway-diagnostic.v1');
  assert.equal(request.kind, 'legacy-diagnostic-shim');
  assert.equal(request.diagnosticOnly, true);
  assert.equal(request.handoffSource, 'ui-chat-legacy-diagnostic-shim');
  assert.equal(uiState.commandId, 'computer-use-command-test');
  assert.equal(request.terminalEquivalentText, input.prompt.trim());
  assert.equal(uiState.terminalEquivalentText, input.prompt.trim());
  assert.equal(uiState.diagnosticOnly, true);
  assert.equal(uiState.legacyWorkspaceGatewayShim, true);
  assert.equal(uiState.guiOwnsExecutor, false);
  assert.equal(uiState.guiOwnsExecutionRoute, false);
  assert.equal((request.diagnosticBoundary as Record<string, unknown>).guiOwnsExecutor, false);
  assert.equal((request.diagnosticBoundary as Record<string, unknown>).gatewayRole, 'legacy diagnostic shim');
  assert.equal('selectedToolIds' in requestRecord, false);
  assert.equal('selectedSenseIds' in requestRecord, false);
  assert.equal('selectedActionIds' in requestRecord, false);
  assert.equal('visionSenseConfig' in uiState, false);
  assert.equal('agentServerBaseUrl' in requestRecord, false);
  assert.equal('agentBackend' in requestRecord, false);
  assert.equal('modelProvider' in requestRecord, false);
  assert.equal(humanApproval.approvalRef, approvalRef);
  assert.equal(provenance.source, 'prior-gui-ask-user');
  assert.equal(provenance.sourceRunId, 'run-needs-approval');
  assert.equal(provenance.riskActionHash, 'risk-hash-1');
  assert.deepEqual(provenance.sourceRiskAuditRef, '.sciforge/vision-runs/cu-risk/risk-audit.json');
  assert.deepEqual(uiState.humanApproval, humanApproval);
  assert.deepEqual(uiState.approvalProvenance, provenance);
  assert.equal('completionEvidencePolicy' in uiState, false);
  assert.deepEqual(uiState.computerUseNext, {
    taskId: 'CU-NEXT-01',
    scenarioId: 'CU-LONG-001',
    title: 'Briefing deck',
    requirements: ['refs-first-evidence-bundle'],
    safetyBoundary: {
      noDomAccessibility: true,
    },
  });
  assert.deepEqual(uiState.computerUseLong, {
    taskId: 'CU-NEXT-01',
    scenarioId: 'CU-LONG-001',
    title: 'Briefing deck',
    safetyBoundary: {
      noDomAccessibility: true,
    },
  });
  assert.doesNotMatch(JSON.stringify(request), /SECRET_NEXT_SHOULD_NOT_LEAK|SECRET_NEXT_BOUNDARY_SHOULD_NOT_LEAK|SECRET_LONG_SHOULD_NOT_LEAK|cuNextTaskId|requiredEvidence/);
});

test('sanitizedComputerUseTaskBindings keeps only refs-first task binding fields', () => {
  assert.deepEqual(sanitizedComputerUseTaskBindings({
    computerUseNext: {
      taskId: 'CU-NEXT-01',
      scenarioId: 'CU-LONG-001',
      title: 'Briefing deck',
      requirements: ['refs-first-evidence-bundle', ''],
      safetyBoundary: {
        noDomAccessibility: true,
        secretFlag: 'SECRET_NEXT_BOUNDARY_SHOULD_NOT_LEAK',
      },
      secret: 'SECRET_NEXT_SHOULD_NOT_LEAK',
    },
    computerUseLong: {
      taskId: 'CU-NEXT-01',
      cuNextTaskId: 'CU-NEXT-01',
      scenarioId: 'CU-LONG-001',
      title: 'Briefing deck',
      requiredEvidence: ['cu-user-acceptance-manifest.json'],
      safetyBoundary: {
        noDomAccessibility: true,
        secretFlag: 'SECRET_LONG_SHOULD_NOT_LEAK',
      },
      rawScenarioMarkdown: 'SECRET_MARKDOWN_SHOULD_NOT_LEAK',
    },
  }), {
    computerUseNext: {
      taskId: 'CU-NEXT-01',
      scenarioId: 'CU-LONG-001',
      title: 'Briefing deck',
      requirements: ['refs-first-evidence-bundle'],
      safetyBoundary: {
        noDomAccessibility: true,
      },
    },
    computerUseLong: {
      taskId: 'CU-NEXT-01',
      scenarioId: 'CU-LONG-001',
      title: 'Briefing deck',
      safetyBoundary: {
        noDomAccessibility: true,
      },
    },
  });
});

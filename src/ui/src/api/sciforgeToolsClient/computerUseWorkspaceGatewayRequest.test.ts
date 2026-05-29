import test from 'node:test';
import assert from 'node:assert/strict';
import type { SendAgentMessageInput } from '../../domain';
import {
  buildComputerUseWorkspaceGatewayRequest,
  computerUseActionProviderRequested,
} from './computerUseWorkspaceGatewayRequest';
import { runtimeRequestInput } from './runtimeEvents.testHelpers';

test('computerUseActionProviderRequested detects slash command and selected package tool', () => {
  assert.equal(computerUseActionProviderRequested(runtimeRequestInput()), false);
  assert.equal(computerUseActionProviderRequested({
    ...runtimeRequestInput(),
    prompt: '/computer-use inspect the visible browser',
  }), true);
  assert.equal(computerUseActionProviderRequested({
    ...runtimeRequestInput(),
    scenarioOverride: {
      ...runtimeRequestInput().scenarioOverride!,
      selectedToolIds: ['action.sciforge.computer-use'],
    },
  }), true);
});

test('buildComputerUseWorkspaceGatewayRequest preserves Computer Use approval provenance and sanitized evidence policy', () => {
  const traceRef = '.sciforge/vision-runs/cu-risk/vision-trace.json';
  const approvalRef = 'approval:computer-use:cu-risk';
  const input: SendAgentMessageInput = {
    ...runtimeRequestInput(),
    prompt: `/computer-use approve --approval-ref "${approvalRef}"`,
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
  const uiState = request.uiState as Record<string, unknown>;
  const humanApproval = request.humanApproval as Record<string, unknown>;
  const provenance = humanApproval.approvalProvenance as Record<string, unknown>;

  assert.equal(request.handoffSource, 'ui-chat');
  assert.equal(uiState.commandId, 'computer-use-command-test');
  assert.deepEqual(request.selectedToolIds, ['local.vision-sense', 'custom.tool']);
  assert.deepEqual(request.selectedSenseIds, ['custom.sense', 'local.vision-sense']);
  assert.deepEqual(request.selectedActionIds, ['custom.action', 'action.sciforge.computer-use']);
  assert.equal(humanApproval.approvalRef, approvalRef);
  assert.equal(provenance.source, 'prior-gui-ask-user');
  assert.equal(provenance.sourceRunId, 'run-needs-approval');
  assert.equal(provenance.riskActionHash, 'risk-hash-1');
  assert.deepEqual(provenance.sourceRiskAuditRef, '.sciforge/vision-runs/cu-risk/risk-audit.json');
  assert.deepEqual(uiState.humanApproval, humanApproval);
  assert.deepEqual(uiState.approvalProvenance, provenance);
  assert.deepEqual(uiState.completionEvidencePolicy, {
    schemaVersion: 'sciforge.completion-evidence-policy.v1',
    producers: [{
      id: 'computer-use.embedded-isolated-desktop-l3',
      enabled: true,
      trigger: 'on-completed-current-run',
    }],
  });
  assert.deepEqual(uiState.visionSenseConfig, {
    desktopBridgeEnabled: true,
    allowSharedSystemInput: true,
  });
});

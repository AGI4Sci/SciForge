import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextEnvelope } from '../runtime/gateway/context-envelope';
import { normalizeGatewayRequest } from '../runtime/gateway/gateway-request';
import { buildAgentHandoffPayload } from './agentHandoffPayload';

const common = {
  scenarioId: 'literature-evidence-review',
  skillDomain: 'literature' as const,
  prompt: 'Summarize ref:A with vision sense and verify the report.',
  workspacePath: '/tmp/sciforge-contract-workspace',
  artifacts: [{ id: 'ref-artifact', type: 'research-report', dataRef: '.sciforge/artifacts/ref-artifact.json' }],
  references: [{ id: 'ref-A', kind: 'artifact', ref: 'artifact:ref-artifact' }],
  availableSkills: ['agentserver.generate.literature'],
  selectedToolIds: ['local.vision-sense'],
  selectedSenseIds: ['local.vision-sense'],
  selectedActionIds: ['workspace.write-report'],
  selectedVerifierIds: ['schema.report', 'human.review'],
  expectedArtifactTypes: ['research-report'],
  selectedComponentIds: ['report-viewer'],
  artifactPolicy: { mode: 'refs-first-bounded-read' },
  referencePolicy: { mode: 'explicit-refs-first' },
  failureRecoveryPolicy: { mode: 'preserve-context' },
  verificationPolicy: {
    required: true,
    mode: 'hybrid',
    riskLevel: 'medium',
    reason: 'Report uses prior refs and writes an artifact.',
    selectedVerifierIds: ['schema.report', 'human.review'],
  },
  humanApprovalPolicy: { required: true, mode: 'required-before-final' },
  uiState: {
    sessionId: 'contract-session',
    recentConversation: ['user: Summarize ref:A'],
    conversationLedger: [{ turn: 1, role: 'user', contentPreview: 'Summarize ref:A' }],
  },
};

test('UI 和 CLI handoff builder 对同一 prompt/refs/capability 配置进入同一 runtime 语义', () => {
  const uiRequest = normalizeGatewayRequest(buildAgentHandoffPayload({ ...common, handoffSource: 'ui-chat' }));
  const cliRequest = normalizeGatewayRequest(buildAgentHandoffPayload(common));

  assert.equal(uiRequest.handoffSource, 'ui-chat');
  assert.equal(cliRequest.handoffSource, 'cli');
  assert.deepEqual(uiRequest.selectedSenseIds, cliRequest.selectedSenseIds);
  assert.deepEqual(uiRequest.selectedActionIds, cliRequest.selectedActionIds);
  assert.deepEqual(uiRequest.selectedVerifierIds, cliRequest.selectedVerifierIds);
  assert.deepEqual(uiRequest.artifactPolicy, cliRequest.artifactPolicy);
  assert.deepEqual(uiRequest.referencePolicy, cliRequest.referencePolicy);
  assert.deepEqual(uiRequest.failureRecoveryPolicy, cliRequest.failureRecoveryPolicy);

  const uiEnvelope = buildContextEnvelope(uiRequest, { workspace: common.workspacePath });
  const cliEnvelope = buildContextEnvelope(cliRequest, { workspace: common.workspacePath });

  assert.deepEqual(uiEnvelope.scenarioFacts.expectedArtifactTypes, cliEnvelope.scenarioFacts.expectedArtifactTypes);
  assert.deepEqual(uiEnvelope.scenarioFacts.selectedSenseIds, cliEnvelope.scenarioFacts.selectedSenseIds);
  assert.deepEqual(uiEnvelope.scenarioFacts.selectedActionIds, cliEnvelope.scenarioFacts.selectedActionIds);
  assert.deepEqual(uiEnvelope.scenarioFacts.selectedVerifierIds, cliEnvelope.scenarioFacts.selectedVerifierIds);
  assert.deepEqual(uiEnvelope.scenarioFacts.verificationPolicy, cliEnvelope.scenarioFacts.verificationPolicy);
});

test('verificationPolicy 和 verificationResult 会进入下一轮上下文', () => {
  const verificationResult = {
    id: 'verify-1',
    verdict: 'pass',
    confidence: 0.91,
    evidenceRefs: ['artifact:ref-artifact'],
    repairHints: [],
  };
  const request = normalizeGatewayRequest(buildAgentHandoffPayload({
    ...common,
    verificationResult,
    recentVerificationResults: [{ id: 'verify-0', verdict: 'uncertain', confidence: 0.4, evidenceRefs: [], repairHints: ['rerun schema check'] }],
  }));
  const envelope = buildContextEnvelope(request, { workspace: common.workspacePath });

  assert.deepEqual({
    required: envelope.scenarioFacts.verificationPolicy?.required,
    mode: envelope.scenarioFacts.verificationPolicy?.mode,
    riskLevel: envelope.scenarioFacts.verificationPolicy?.riskLevel,
    reason: envelope.scenarioFacts.verificationPolicy?.reason,
    selectedVerifierIds: envelope.scenarioFacts.verificationPolicy?.selectedVerifierIds,
  }, common.verificationPolicy);
  assert.deepEqual(envelope.sessionFacts.verificationResult, verificationResult);
  assert.ok(envelope.longTermRefs.verificationResults?.some((entry) => (entry as Record<string, unknown>).id === 'verify-1'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentHandoffPayload } from './handoff-payload';

const common = {
  scenarioId: 'literature-evidence-review',
  skillDomain: 'literature' as const,
  prompt: 'Summarize ref:A with observe provider and verify the report.',
  workspacePath: '/tmp/sciforge-contract-workspace',
  artifacts: [{ id: 'ref-artifact', type: 'research-report', dataRef: '.sciforge/artifacts/ref-artifact.json' }],
  references: [{ id: 'ref-A', kind: 'artifact', ref: 'artifact:ref-artifact' }],
  availableSkills: ['agentserver.generate.literature'],
  selectedToolIds: ['local.pubchem-lookup'],
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

test('builds a UI handoff payload with shared contract and selected capabilities', () => {
  const payload = buildAgentHandoffPayload({ ...common, handoffSource: 'ui-chat' });

  assert.equal(payload.handoffSource, 'ui-chat');
  assert.equal(payload.sharedAgentContract.source, 'ui-chat');
  assert.equal(payload.sharedAgentContract.decisionOwner, 'AgentServer');
  assert.deepEqual(payload.selectedSenseIds, common.selectedSenseIds);
  assert.deepEqual(payload.selectedActionIds, common.selectedActionIds);
  assert.deepEqual(payload.selectedVerifierIds, common.selectedVerifierIds);
  assert.deepEqual(payload.artifactPolicy, common.artifactPolicy);
  assert.deepEqual(payload.referencePolicy, common.referencePolicy);
  assert.deepEqual(payload.failureRecoveryPolicy, common.failureRecoveryPolicy);
  assert.deepEqual(payload.uiState?.sharedAgentContract, payload.sharedAgentContract);
  assert.deepEqual(payload.uiState?.agentContext, undefined);
});

test('defaults CLI handoff source and carries verification/failure policy snapshots', () => {
  const verificationResult = {
    id: 'verify-1',
    verdict: 'pass',
    confidence: 0.91,
    evidenceRefs: ['artifact:ref-artifact'],
    repairHints: [],
  };
  const recentVerificationResults = [
    { id: 'verify-0', verdict: 'uncertain', confidence: 0.4, evidenceRefs: [], repairHints: ['rerun schema check'] },
  ];
  const failureRecoveryPolicy = {
    mode: 'preserve-context' as const,
    priorFailureReason: '工具执行失败：命令缺少依赖，acceptance 未通过。',
    recoverActions: ['打开 stderrRef 查看缺失依赖'],
    attemptHistoryRefs: ['file:.sciforge/logs/run.err'],
  };

  const payload = buildAgentHandoffPayload({
    ...common,
    verificationResult,
    recentVerificationResults,
    failureRecoveryPolicy,
  });

  assert.equal(payload.handoffSource, 'cli');
  assert.equal(payload.sharedAgentContract.source, 'cli');
  assert.deepEqual(payload.verificationResult, verificationResult);
  assert.deepEqual(payload.recentVerificationResults, recentVerificationResults);
  assert.deepEqual(payload.failureRecoveryPolicy, failureRecoveryPolicy);
  assert.deepEqual(payload.uiState?.verificationResult, verificationResult);
  assert.deepEqual(payload.uiState?.recentVerificationResults, recentVerificationResults);
  assert.deepEqual(payload.uiState?.failureRecoveryPolicy, failureRecoveryPolicy);
});

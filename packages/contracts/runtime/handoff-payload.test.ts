import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTION_LOG_REF_EXPANSION_POLICY,
} from './artifact-policy';
import {
  buildAgentHandoffPayload,
  isAgentHandoffArtifactPolicy,
  isAgentHandoffReferencePolicy,
  isFailureRecoveryEvidenceExpansionPolicy,
  isAgentHandoffVerificationSnapshot,
  isFailureRecoveryAttemptSnapshot,
  isFailureRecoveryPolicy,
  type AgentHandoffArtifactPolicy,
  type AgentHandoffReferencePolicy,
  type AgentHandoffVerificationSnapshot,
  type FailureRecoveryPolicy,
} from './handoff-payload';

const common = {
  scenarioId: 'literature-evidence-review',
  skillDomain: 'literature' as const,
  prompt: 'Summarize ref:A with observe provider and verify the report.',
  workspacePath: '/tmp/sciforge-contract-workspace',
  artifacts: [{ id: 'ref-artifact', type: 'research-report', dataRef: '.sciforge/artifacts/ref-artifact.json' }],
  references: [{ id: 'ref-A', kind: 'artifact', ref: 'artifact:ref-artifact' }],
  selectedSkillIds: ['agentserver.generate.literature'],
  selectedToolIds: ['local.pubchem-lookup'],
  selectedSenseIds: ['local.vision-sense'],
  selectedActionIds: ['workspace.write-report'],
  selectedVerifierIds: ['schema.report', 'human.review'],
  expectedArtifactTypes: ['research-report'],
  selectedComponentIds: ['report-viewer'],
  artifactPolicy: { mode: 'refs-first-bounded-read' } satisfies AgentHandoffArtifactPolicy,
  referencePolicy: { mode: 'explicit-refs-first' } satisfies AgentHandoffReferencePolicy,
  failureRecoveryPolicy: { mode: 'preserve-context' } satisfies FailureRecoveryPolicy,
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
  } satisfies AgentHandoffVerificationSnapshot;
  const recentVerificationResults = [
    { id: 'verify-0', verdict: 'uncertain', confidence: 0.4, evidenceRefs: [], repairHints: ['rerun schema check'] },
  ] satisfies AgentHandoffVerificationSnapshot[];
  const failureRecoveryPolicy = {
    mode: 'preserve-context',
    priorFailureReason: '工具执行失败：命令缺少依赖，acceptance 未通过。',
    recoverActions: ['打开 stderrRef 查看缺失依赖'],
    attemptHistoryRefs: ['file:.sciforge/logs/run.err'],
  } satisfies FailureRecoveryPolicy;

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

test('exports narrow handoff policy guards without breaking loose transport records', () => {
  const artifactPolicy = {
    mode: 'refs-first-bounded-read',
    maxInlineBytes: 2048,
    expectedArtifactTypes: ['research-report'],
    requiredArtifactRefs: ['artifact:ref-artifact'],
    reason: 'Keep artifact content ref-backed unless bounded.',
  } satisfies AgentHandoffArtifactPolicy;
  const referencePolicy = {
    mode: 'explicit-refs-first',
    currentReferenceCount: 1,
    requiredRefs: ['artifact:ref-artifact'],
    allowHistoryFallback: false,
    defaultAction: 'Use explicit current-turn refs before history.',
  } satisfies AgentHandoffReferencePolicy;
  const attempt = {
    id: 'EU-failed-1',
    status: 'repair-needed',
    tool: 'generic.workspace-tool',
    failureReason: 'command exited 127',
    stderrRef: 'file:.sciforge/logs/run.err',
    outputRef: 'file:.sciforge/task-results/run.json',
    evidenceRefs: ['file:.sciforge/logs/run.err'],
    nextStep: '修复依赖后重跑该 execution unit',
  };
  const failureRecoveryPolicy = {
    mode: 'repair-first',
    priorFailureReason: 'workspace task failed',
    recoverActions: ['read stderrRef'],
    attemptHistoryRefs: ['file:.sciforge/logs/run.err'],
    attemptHistory: [attempt],
    evidenceRefs: ['file:.sciforge/logs/run.err'],
    evidenceExpansionPolicy: {
      defaultAction: 'refs-and-digests-only',
      logRefs: EXECUTION_LOG_REF_EXPANSION_POLICY,
      artifactRefs: 'prefer ref-backed artifacts before body expansion',
    },
    nextStep: 'repair dependency',
  } satisfies FailureRecoveryPolicy;
  const verificationSnapshot = {
    id: 'verify-2',
    verdict: 'needs-human',
    confidence: 0.52,
    evidenceRefs: ['artifact:ref-artifact'],
    repairHints: ['request approval'],
    traceRef: 'file:.sciforge/logs/verify.json',
  } satisfies AgentHandoffVerificationSnapshot;

  assert.equal(isAgentHandoffArtifactPolicy(artifactPolicy), true);
  assert.equal(isAgentHandoffReferencePolicy(referencePolicy), true);
  assert.equal(isFailureRecoveryAttemptSnapshot(attempt), true);
  assert.equal(isFailureRecoveryEvidenceExpansionPolicy(failureRecoveryPolicy.evidenceExpansionPolicy), true);
  assert.equal(isFailureRecoveryPolicy(failureRecoveryPolicy), true);
  assert.equal(isAgentHandoffVerificationSnapshot(verificationSnapshot), true);

  assert.equal(isAgentHandoffArtifactPolicy({ mode: 'inline-everything' }), false);
  assert.equal(isAgentHandoffReferencePolicy({ mode: 'explicit-refs-first', requiredRefs: [42] }), false);
  assert.equal(isFailureRecoveryEvidenceExpansionPolicy({ logRefs: EXECUTION_LOG_REF_EXPANSION_POLICY }), false);
  assert.equal(isFailureRecoveryPolicy({ mode: 'preserve-context', attemptHistory: [{ evidenceRefs: [42] }] }), false);
  assert.equal(isAgentHandoffVerificationSnapshot({ verdict: 'pass', evidenceRefs: [42] }), false);

  const loosePolicy = { mode: 'legacy-mode', legacyFlag: true };
  const payload = buildAgentHandoffPayload({
    ...common,
    artifactPolicy: loosePolicy,
  });

  assert.deepEqual(payload.artifactPolicy, loosePolicy);
  assert.deepEqual(payload.uiState?.artifactPolicy, loosePolicy);
});

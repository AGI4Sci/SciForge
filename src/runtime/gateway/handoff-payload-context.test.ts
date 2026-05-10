import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAgentHandoffPayload } from '@sciforge-ui/runtime-contract/handoff-payload';
import { buildContextEnvelope } from './context-envelope';
import { normalizeGatewayRequest } from './gateway-request';
import type { VerificationPolicy } from '../runtime-types';

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
  } satisfies VerificationPolicy,
  humanApprovalPolicy: { required: true, mode: 'required-before-final' },
  uiState: {
    sessionId: 'contract-session',
    recentConversation: ['user: Summarize ref:A'],
    conversationLedger: [{ turn: 1, role: 'user', contentPreview: 'Summarize ref:A' }],
  },
};

test('UI and CLI handoff payloads normalize to the same runtime semantics', () => {
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

test('harness-projected verification policy and result enter the next-turn context envelope', () => {
  const projectedVerificationPolicy: VerificationPolicy = common.verificationPolicy;
  const verificationResult = {
    id: 'verify-1',
    verdict: 'pass',
    confidence: 0.91,
    evidenceRefs: ['artifact:ref-artifact'],
    repairHints: [],
  };
  const request = {
    ...normalizeGatewayRequest(buildAgentHandoffPayload({
      ...common,
      verificationResult,
      recentVerificationResults: [{ id: 'verify-0', verdict: 'uncertain', confidence: 0.4, evidenceRefs: [], repairHints: ['rerun schema check'] }],
    })),
    verificationPolicy: projectedVerificationPolicy,
  };
  const envelope = buildContextEnvelope(request, { workspace: common.workspacePath });

  const verificationPolicy = envelope.scenarioFacts.verificationPolicy as Record<string, unknown> | undefined;
  assert.deepEqual({
    required: verificationPolicy?.required,
    mode: verificationPolicy?.mode,
    riskLevel: verificationPolicy?.riskLevel,
    reason: verificationPolicy?.reason,
    selectedVerifierIds: verificationPolicy?.selectedVerifierIds,
  }, common.verificationPolicy);
  assert.deepEqual(envelope.sessionFacts.verificationResult, verificationResult);
  assert.ok(envelope.longTermRefs.verificationResults?.some((entry) => (entry as Record<string, unknown>).id === 'verify-1'));
});

test('failure recovery policy carries failure summary and evidence refs into next-turn context', () => {
  const failureRecoveryPolicy = {
    mode: 'preserve-context' as const,
    priorFailureReason: '工具执行失败：命令缺少依赖，acceptance 未通过。',
    recoverActions: ['打开 stderrRef 查看缺失依赖', '安装依赖后从失败 execution unit 继续'],
    attemptHistoryRefs: ['file:.sciforge/logs/run.err'],
    attemptHistory: [{
      id: 'EU-failed-1',
      status: 'repair-needed',
      tool: 'generic.workspace-tool',
      failureReason: 'command exited 127',
      stderrRef: 'file:.sciforge/logs/run.err',
      outputRef: 'file:.sciforge/task-results/run.json',
      nextStep: '修复依赖后重跑该 execution unit',
    }],
  };
  const request = normalizeGatewayRequest(buildAgentHandoffPayload({
    ...common,
    prompt: '继续修复上一轮失败',
    failureRecoveryPolicy,
  }));
  const envelope = buildContextEnvelope(request, { workspace: common.workspacePath });

  const failures = envelope.sessionFacts.recentFailures as Array<Record<string, unknown>> | undefined;
  assert.ok(failures?.some((entry) => String(entry.failureReason).includes('工具执行失败')));
  assert.ok(failures?.some((entry) => (entry.evidenceRefs as string[] | undefined)?.includes('file:.sciforge/logs/run.err')));
  assert.ok(envelope.longTermRefs.failureEvidenceRefs?.includes('file:.sciforge/logs/run.err'));
  assert.match(envelope.continuityRules.join('\n'), /recentFailures|failureEvidenceRefs/);
});

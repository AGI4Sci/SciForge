import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  CAPABILITY_BUDGET_DEBIT_CONTRACT_ID,
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
} from '@sciforge-ui/runtime-contract/capability-budget';

import { runOfflineLiteratureRetrieval } from '../../packages/skills/literature/index.js';
import {
  buildObserveInvocationPlan,
  compactObserveTraceRefs,
  runObserveInvocationPlan,
  type ObserveProviderRuntime,
} from '../../src/runtime/observe/orchestration.js';
import { genericLoopPayload } from '../../src/runtime/vision-sense/computer-use-trace-output.js';
import { runWorkspaceRuntimeGateway } from '../../src/runtime/workspace-runtime-gateway.js';
import { runWorkspaceOpenAction } from '../../src/runtime/server/workspace-open.js';
import { agentVerifierRequestFixture } from '../../packages/verifiers/agent-rubric/fixture.js';
import { createMockAgentVerifierProvider } from '../../packages/verifiers/agent-rubric/index.js';
import { createHumanApprovalFixtureProvider } from '../../packages/verifiers/fixtures/human-approval.js';

const debitLines: CapabilityBudgetDebitLine[] = [
  {
    dimension: 'toolCalls',
    amount: 1,
    limit: 3,
    remaining: 2,
    reason: 'capability invocation called one tool',
    sourceRef: 'tool:pubmed.search',
  },
  {
    dimension: 'networkCalls',
    amount: 1,
    limit: 1,
    remaining: 0,
    reason: 'provider request consumed the remaining network call budget',
    sourceRef: 'provider:pubmed',
  },
  {
    dimension: 'resultItems',
    amount: 0,
    limit: 30,
    remaining: 30,
  },
];

const record = createCapabilityBudgetDebitRecord({
  debitId: 'budget-debit:invoke-1',
  invocationId: 'capability-invocation:1',
  capabilityId: 'tool.pubmed-search',
  candidateId: 'candidate:tool.pubmed-search',
  manifestRef: 'capability:tool.pubmed-search',
  subjectRefs: ['run:research-1', 'run:research-1', 'artifact:evidence-matrix'],
  debitLines,
  sinkRefs: {
    executionUnitRef: 'executionUnit:research-1',
    workEvidenceRefs: ['workEvidence:provider-attempt-1', 'workEvidence:provider-attempt-1'],
    auditRefs: ['audit:capability-broker-1'],
  },
  createdAt: '2026-05-10T00:00:00.000Z',
  metadata: {
    profileId: 'research-grade',
  },
});

assert.equal(record.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(record.schemaVersion, 1);
assert.equal(record.capabilityId, 'tool.pubmed-search');
assert.equal(record.invocationId, 'capability-invocation:1');
assert.deepEqual(record.subjectRefs, ['run:research-1', 'artifact:evidence-matrix']);
assert.deepEqual(record.debitLines.map((line) => line.dimension), ['toolCalls', 'networkCalls']);
assert.equal(record.debitLines.find((line) => line.dimension === 'toolCalls')?.amount, 1);
assert.equal(record.exceeded, false);
assert.deepEqual(record.exhaustedDimensions, ['networkCalls']);
assert.equal(record.sinkRefs.executionUnitRef, 'executionUnit:research-1');
assert.deepEqual(record.sinkRefs.workEvidenceRefs, ['workEvidence:provider-attempt-1']);
assert.deepEqual(record.sinkRefs.auditRefs, ['audit:capability-broker-1']);
assert.equal(record.metadata?.profileId, 'research-grade');

const normalizedSinkRefRecord = createCapabilityBudgetDebitRecord({
  debitId: 'budget-debit:stable-sink-refs',
  invocationId: 'capability-invocation:stable-sink-refs',
  capabilityId: 'tool.stable-sink-refs',
  debitLines: [{
    dimension: 'toolCalls',
    amount: 1,
    sourceRef: 'tool:stable-sink-refs',
  }],
  sinkRefs: {
    executionUnitRef: '  executionUnit:stable-sink-refs  ',
    workEvidenceRefs: [
      ' workEvidence:stable-sink-refs ',
      'workEvidence:stable-sink-refs',
      '',
    ],
    auditRefs: [
      'audit:stable-sink-refs',
      ' audit:stable-sink-refs ',
      '   ',
    ],
  },
});
assert.equal(normalizedSinkRefRecord.sinkRefs.executionUnitRef, 'executionUnit:stable-sink-refs');
assert.deepEqual(normalizedSinkRefRecord.sinkRefs.workEvidenceRefs, ['workEvidence:stable-sink-refs']);
assert.deepEqual(normalizedSinkRefRecord.sinkRefs.auditRefs, ['audit:stable-sink-refs']);

const literatureRuntimeOutput = runOfflineLiteratureRetrieval({
  request: {
    query: 'budget debit runtime wiring',
    databases: ['pubmed', 'openalex'],
    includeAbstracts: true,
  },
  providerFixtures: [
    {
      providerId: 'pubmed',
      records: [{
        providerRecordId: 'pmid-budget-debit',
        title: 'Budget debit runtime wiring',
        year: 2026,
        pmid: '999001',
      }],
    },
    {
      providerId: 'openalex',
      records: [{
        providerRecordId: 'openalex-budget-debit',
        title: 'Budget debit runtime wiring',
        year: 2026,
        doi: '10.5555/budget.debit.runtime',
      }],
    },
  ],
});

const runtimeDebit = literatureRuntimeOutput.budgetDebits?.[0];
assert.ok(runtimeDebit, 'literature retrieval runner should emit a budget debit record');
assert.equal(runtimeDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(runtimeDebit.capabilityId, 'literature.retrieval');
assert.deepEqual(literatureRuntimeOutput.workEvidence[0]?.budgetDebitRefs, [runtimeDebit.debitId]);
assert.ok(literatureRuntimeOutput.providerAttempts.every((attempt) => attempt.budgetDebitRefs?.includes(runtimeDebit.debitId)));
assert.deepEqual(runtimeDebit.sinkRefs.workEvidenceRefs, [literatureRuntimeOutput.workEvidence[0]?.id]);
assert.ok(runtimeDebit.sinkRefs.auditRefs.includes('audit:literature-retrieval-runner'));
assert.ok(runtimeDebit.debitLines.some((line) => line.dimension === 'networkCalls' && line.amount === 2));

const computerUsePayload = genericLoopPayload({
  request: {
    skillDomain: 'literature',
    prompt: 'Use generic computer use to click the visible upload button.',
    workspacePath: '/tmp/sciforge-budget-debit-smoke',
    artifacts: [],
    selectedToolIds: ['local.vision-sense'],
  },
  workspace: '/tmp/sciforge-budget-debit-smoke',
  runId: 'budget-debit-computer-use-smoke',
  tracePath: '/tmp/sciforge-budget-debit-smoke/.sciforge/vision-runs/budget-debit-computer-use-smoke/vision-trace.json',
  screenshotRefs: [
    {
      id: 'step-001-before-display-1',
      path: '.sciforge/vision-runs/budget-debit-computer-use-smoke/step-001-before-display-1.png',
      absPath: '/tmp/sciforge-budget-debit-smoke/.sciforge/vision-runs/budget-debit-computer-use-smoke/step-001-before-display-1.png',
      displayId: 1,
      sha256: 'before-sha',
      bytes: 128,
    },
    {
      id: 'step-001-after-display-1',
      path: '.sciforge/vision-runs/budget-debit-computer-use-smoke/step-001-after-display-1.png',
      absPath: '/tmp/sciforge-budget-debit-smoke/.sciforge/vision-runs/budget-debit-computer-use-smoke/step-001-after-display-1.png',
      displayId: 1,
      sha256: 'after-sha',
      bytes: 256,
    },
  ],
  status: 'done',
  failureReason: '',
  actionCount: 1,
  maxSteps: 3,
  dryRun: true,
  desktopPlatform: 'darwin',
});

const computerUseDebit = computerUsePayload.budgetDebits?.[0];
assert.ok(computerUseDebit, 'Computer Use generic loop payload should emit a budget debit record');
assert.equal(computerUseDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(computerUseDebit.capabilityId, 'action.sciforge.computer-use');
assert.deepEqual(computerUsePayload.executionUnits[0]?.budgetDebitRefs, [computerUseDebit.debitId]);
assert.deepEqual(computerUsePayload.workEvidence?.[0]?.budgetDebitRefs, [computerUseDebit.debitId]);
assert.equal(computerUseDebit.sinkRefs.executionUnitRef, computerUsePayload.executionUnits[0]?.id);
assert.deepEqual(computerUseDebit.sinkRefs.workEvidenceRefs, [computerUsePayload.workEvidence?.[0]?.id]);
assert.ok(computerUseDebit.sinkRefs.auditRefs.includes('audit:computer-use-action-provider-loop'));
assert.ok(computerUsePayload.logs?.some((entry) => entry.ref === 'audit:computer-use-action-provider-loop' && Array.isArray(entry.budgetDebitRefs)));
assert.ok(computerUseDebit.debitLines.some((line) => line.dimension === 'actionSteps' && line.amount === 1 && line.remaining === 2));
assert.ok(computerUseDebit.debitLines.some((line) => line.dimension === 'observeCalls' && line.amount === 2));

const observeProvider: ObserveProviderRuntime = {
  contract: {
    id: 'local.vision-observe',
    acceptedModalities: ['screenshot'],
    outputKind: 'text',
    expectedMultipleCalls: true,
  },
  async invoke(input) {
    return {
      status: 'ok',
      text: `observed ${input.modalities[0]?.ref}`,
      artifactRefs: ['artifact:observe-crop'],
      traceRef: `${input.callRef}:trace`,
      compactSummary: 'Observed the screenshot and emitted a cropped evidence artifact.',
    };
  },
};

const observePlan = buildObserveInvocationPlan({
  goal: 'Budget debit observe provider invocation smoke',
  runRef: 'run:budget-debit-observe',
  providers: [observeProvider.contract],
  intents: [{
    instruction: 'Read the visible dialog title',
    modalities: [{ kind: 'screenshot', ref: 'artifact:screenshot-budget-debit', mimeType: 'image/png' }],
  }],
});
const observeRecords = await runObserveInvocationPlan(observePlan, [observeProvider]);
const observeRecord = observeRecords[0];
const observeDebit = observeRecord?.budgetDebits[0];
assert.ok(observeRecord, 'observe provider invocation should emit a runtime record');
assert.ok(observeDebit, 'observe provider invocation should emit a budget debit record');
assert.equal(observeDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(observeDebit.capabilityId, 'local.vision-observe');
assert.deepEqual(observeRecord.executionUnit.budgetDebitRefs, [observeDebit.debitId]);
assert.deepEqual(observeRecord.workEvidence.budgetDebitRefs, [observeDebit.debitId]);
assert.deepEqual(observeRecord.audit.budgetDebitRefs, [observeDebit.debitId]);
assert.equal(observeDebit.sinkRefs.executionUnitRef, observeRecord.executionUnit.id);
assert.deepEqual(observeDebit.sinkRefs.workEvidenceRefs, [observeRecord.workEvidence.id]);
assert.ok(observeDebit.sinkRefs.auditRefs.includes(observeRecord.audit.ref));
assert.ok(observeDebit.debitLines.some((line) => line.dimension === 'observeCalls' && line.amount === 1));
assert.deepEqual(compactObserveTraceRefs(observeRecords)[0]?.budgetDebitRefs, [observeDebit.debitId]);

const agentRubricVerifier = createMockAgentVerifierProvider();
const agentRubricResult = await agentRubricVerifier.verify(agentVerifierRequestFixture);
const agentRubricDebit = agentRubricResult.budgetDebits[0];
assert.ok(agentRubricDebit, 'agent rubric verifier should emit a budget debit record');
assert.equal(agentRubricDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(agentRubricDebit.capabilityId, 'verifier.agent-rubric');
assert.deepEqual(agentRubricResult.budgetDebitRefs, [agentRubricDebit.debitId]);
assert.ok(agentRubricDebit.subjectRefs.includes(agentRubricResult.resultRef));
assert.ok(agentRubricDebit.subjectRefs.includes('result:final-answer'));
assert.deepEqual(agentRubricDebit.sinkRefs.auditRefs, agentRubricResult.auditRefs);
assert.ok(agentRubricDebit.debitLines.some((line) => line.dimension === 'providers' && line.amount === 1));
assert.ok(agentRubricDebit.debitLines.some((line) => line.dimension === 'costUnits' && line.amount === agentRubricResult.criterionScores.length));

const humanApprovalVerifier = createHumanApprovalFixtureProvider();
const humanApprovalResult = await humanApprovalVerifier.verify({
  goal: 'Approve high-risk action output after reviewing refs.',
  resultRefs: ['result:final-answer'],
  artifactRefs: ['artifact:approval-summary'],
  traceRefs: ['trace:run-001'],
  verificationPolicy: {
    required: true,
    mode: 'human',
    riskLevel: 'high',
  },
  decision: {
    decision: 'accept',
    decisionRef: 'human-approval:budget-debit-smoke',
    approverRef: 'user:budget-debit-reviewer',
    evidenceRefs: ['artifact:signed-approval'],
  },
});
const humanApprovalDebit = humanApprovalResult.budgetDebits[0];
assert.ok(humanApprovalDebit, 'human approval verifier should emit a budget debit record');
assert.equal(humanApprovalDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(humanApprovalDebit.capabilityId, 'verifier.fixture.human-approval');
assert.deepEqual(humanApprovalResult.budgetDebitRefs, [humanApprovalDebit.debitId]);
assert.ok(humanApprovalDebit.subjectRefs.includes(humanApprovalResult.resultRef));
assert.ok(humanApprovalDebit.subjectRefs.includes('result:final-answer'));
assert.ok(humanApprovalDebit.subjectRefs.includes('artifact:approval-summary'));
assert.ok(humanApprovalDebit.subjectRefs.includes('trace:run-001'));
assert.ok(humanApprovalDebit.subjectRefs.includes('artifact:signed-approval'));
assert.deepEqual(humanApprovalDebit.sinkRefs.auditRefs, humanApprovalResult.auditRefs);
assert.ok(humanApprovalDebit.debitLines.some((line) => line.dimension === 'providers' && line.amount === 1));
assert.ok(humanApprovalDebit.debitLines.some((line) => line.dimension === 'costUnits' && line.amount === 1));

const workspaceOpenRoot = await mkdtemp(join(tmpdir(), 'sciforge-capability-budget-workspace-open-'));
await mkdir(join(workspaceOpenRoot, 'reports'), { recursive: true });
const workspaceOpenTarget = join(workspaceOpenRoot, 'reports', 'summary.md');
await writeFile(workspaceOpenTarget, '# Workspace open budget debit\n', 'utf8');
const workspaceOpenResult = await runWorkspaceOpenAction({
  workspacePath: workspaceOpenRoot,
  path: 'reports/summary.md',
  action: 'open-external',
  dryRun: true,
});
const workspaceOpenRepeat = await runWorkspaceOpenAction({
  workspacePath: workspaceOpenRoot,
  path: workspaceOpenTarget,
  action: 'open-external',
  dryRun: true,
});
const workspaceOpenDebit = workspaceOpenResult.budgetDebits?.[0];
assert.ok(workspaceOpenDebit, 'workspace open action should emit a budget debit record');
assert.equal(workspaceOpenDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.equal(workspaceOpenDebit.capabilityId, 'runtime.workspace-open');
assert.deepEqual(workspaceOpenResult.budgetDebitRefs, [workspaceOpenDebit.debitId]);
assert.deepEqual(workspaceOpenResult.executionUnit?.budgetDebitRefs, [workspaceOpenDebit.debitId]);
assert.deepEqual(workspaceOpenResult.workEvidence?.budgetDebitRefs, [workspaceOpenDebit.debitId]);
assert.deepEqual(workspaceOpenResult.audit?.budgetDebitRefs, [workspaceOpenDebit.debitId]);
assert.equal(workspaceOpenDebit.sinkRefs.executionUnitRef, workspaceOpenResult.executionUnit?.id);
assert.deepEqual(workspaceOpenDebit.sinkRefs.workEvidenceRefs, [workspaceOpenResult.workEvidence?.id]);
assert.ok(workspaceOpenDebit.sinkRefs.auditRefs.includes(workspaceOpenResult.audit?.ref ?? ''));
assert.ok(workspaceOpenDebit.debitLines.some((line) => line.dimension === 'actionSteps' && line.amount === 1));
assert.ok(workspaceOpenDebit.debitLines.some((line) => line.dimension === 'costUnits' && line.amount === 1));
assert.equal(workspaceOpenRepeat.budgetDebits?.[0]?.debitId, workspaceOpenDebit.debitId);
assert.equal(workspaceOpenRepeat.executionUnit?.id, workspaceOpenResult.executionUnit?.id);

const retiredAgentServerWorkspace = await mkdtemp(join(tmpdir(), 'sciforge-capability-budget-retired-agentserver-'));
const retiredAgentServerPayload = await runWorkspaceRuntimeGateway({
  skillDomain: 'literature',
  prompt: 'generated budget debit dynamic glue task',
  workspacePath: retiredAgentServerWorkspace,
  agentServerBaseUrl: 'http://127.0.0.1:1',
  expectedArtifactTypes: ['research-report'],
  availableSkills: ['missing.skill'],
  uiState: {
    sessionId: 'budget-debit-session',
    forceAgentServerGeneration: true,
    freshTaskGeneration: true,
  },
  artifacts: [],
});
assert.equal(retiredAgentServerPayload.claimType, 'runtime-diagnostic');
assert.match(retiredAgentServerPayload.message, /没有回落到旧 backend generation|legacy backend generation fallback is retired/i);
const retiredFallbackDebit = retiredAgentServerPayload.budgetDebits?.find((debit) => debit.capabilityId === 'sciforge.runtime-verification-gate');
assert.ok(retiredFallbackDebit, 'retired AgentServer fallback should still emit a runtime verification budget debit');
assert.equal(retiredFallbackDebit.contract, CAPABILITY_BUDGET_DEBIT_CONTRACT_ID);
assert.ok(hasBudgetDebitRef(retiredAgentServerPayload.executionUnits[0], retiredFallbackDebit.debitId));
assert.equal(retiredFallbackDebit.sinkRefs.executionUnitRef, retiredAgentServerPayload.executionUnits[0]?.id);
assert.ok(retiredFallbackDebit.sinkRefs.auditRefs.some((ref) => ref.startsWith('audit:runtime-verification-gate:')));

console.log('[ok] capability invocation budget debit record is contract-shaped, sink-addressable, and wired into literature.retrieval, Computer Use, observe provider invocation, agent rubric verifier, human approval verifier, workspace open, and retired AgentServer fallback fail-closed runtime verification output');

function hasBudgetDebitRef(record: unknown, debitId: string) {
  return typeof record === 'object'
    && record !== null
    && Array.isArray((record as { budgetDebitRefs?: unknown }).budgetDebitRefs)
    && ((record as { budgetDebitRefs: unknown[] }).budgetDebitRefs).includes(debitId);
}

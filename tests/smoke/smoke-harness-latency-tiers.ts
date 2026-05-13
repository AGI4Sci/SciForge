import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import { getHarnessProfile } from '../../packages/agent-harness/src/profiles';
import type {
  ConversationAnswerStrategy,
  ConversationAuditHydration,
  ConversationEvidenceMode,
  HarnessProfile,
  LatencyTier,
  ResultPresentationStatus,
} from '../../packages/agent-harness/src/contracts';
import {
  materializeResultPresentationContract,
  validateResultPresentationContract,
} from '../../src/runtime/gateway/result-presentation-contract';

interface LatencyCase {
  id: string;
  profileId?: string;
  latencyTier: LatencyTier;
  prompt: string;
  expected: {
    maxFirstResultDeadlineMs: number;
    maxToolCalls: number;
    minPhaseCount: number;
    status: ResultPresentationStatus;
    background: boolean;
    conversation: {
      answerStrategy: ConversationAnswerStrategy;
      evidenceMode: ConversationEvidenceMode;
      auditHydration: ConversationAuditHydration;
      maxInlineEvidenceRefs: number;
    };
  };
}

const failureProfile = profileWithFailurePresentation();
const runtime = createHarnessRuntime({
  profiles: {
    'latency-smoke.failure': failureProfile,
  },
});

const latencyCases: LatencyCase[] = [
  {
    id: 'quick-direct-answer',
    profileId: 'fast-answer',
    latencyTier: 'quick',
    prompt: 'Summarize the current context in two bullets.',
    expected: {
      maxFirstResultDeadlineMs: 15000,
      maxToolCalls: 2,
      minPhaseCount: 2,
      status: 'complete',
      background: false,
      conversation: { answerStrategy: 'answer-first', evidenceMode: 'refs-first', auditHydration: 'on-demand', maxInlineEvidenceRefs: 1 },
    },
  },
  {
    id: 'bounded-small-retrieval',
    profileId: 'balanced-default',
    latencyTier: 'bounded',
    prompt: 'Search one source and summarize the relevant result.',
    expected: {
      maxFirstResultDeadlineMs: 30000,
      maxToolCalls: 6,
      minPhaseCount: 4,
      status: 'complete',
      background: false,
      conversation: { answerStrategy: 'answer-first', evidenceMode: 'refs-first', auditHydration: 'on-demand', maxInlineEvidenceRefs: 3 },
    },
  },
  {
    id: 'deep-research-request',
    profileId: 'research-grade',
    latencyTier: 'deep',
    prompt: 'Do a thorough comparison with strict verification and cited evidence.',
    expected: {
      maxFirstResultDeadlineMs: 30000,
      maxToolCalls: 12,
      minPhaseCount: 5,
      status: 'complete',
      background: false,
      conversation: { answerStrategy: 'evidence-first', evidenceMode: 'expanded', auditHydration: 'required', maxInlineEvidenceRefs: 4 },
    },
  },
  {
    id: 'background-continuation',
    profileId: 'balanced-default',
    latencyTier: 'background',
    prompt: 'Start a long report, give me the partial result first, and keep working in background.',
    expected: {
      maxFirstResultDeadlineMs: 30000,
      maxToolCalls: 20,
      minPhaseCount: 4,
      status: 'background-running',
      background: true,
      conversation: { answerStrategy: 'answer-first', evidenceMode: 'refs-first', auditHydration: 'background', maxInlineEvidenceRefs: 2 },
    },
  },
  {
    id: 'failure-presentation',
    profileId: 'latency-smoke.failure',
    latencyTier: 'bounded',
    prompt: 'Return a structured failure if no result can be produced.',
    expected: {
      maxFirstResultDeadlineMs: 30000,
      maxToolCalls: 6,
      minPhaseCount: 4,
      status: 'failed',
      background: false,
      conversation: { answerStrategy: 'answer-first', evidenceMode: 'refs-first', auditHydration: 'on-demand', maxInlineEvidenceRefs: 3 },
    },
  },
];

const benchmarkSummary = [];

for (const testCase of latencyCases) {
  const evaluation = await runtime.evaluate({
    requestId: `latency-smoke-${testCase.id}`,
    profileId: testCase.profileId,
    latencyTier: testCase.latencyTier,
    prompt: testCase.prompt,
  });
  const { contract, trace } = evaluation;
  const phases = contract.progressPlan.phaseNames ?? contract.progressPlan.visibleMilestones;

  assert.equal(contract.latencyTier, testCase.latencyTier, `${testCase.id}: latency tier`);
  assert.ok(contract.progressPlan.firstResultDeadlineMs, `${testCase.id}: first result deadline is required`);
  assert.ok(contract.progressPlan.backgroundAfterMs, `${testCase.id}: background deadline is required`);
  assert.ok(Object.keys(contract.progressPlan.phaseDeadlines ?? {}).length >= testCase.expected.minPhaseCount, `${testCase.id}: phase deadlines`);
  assert.ok(contract.progressPlan.firstResultDeadlineMs <= testCase.expected.maxFirstResultDeadlineMs, `${testCase.id}: first result deadline SLA`);
  assert.ok(contract.progressPlan.backgroundAfterMs >= contract.progressPlan.firstResultDeadlineMs, `${testCase.id}: background follows first result`);
  assert.ok(contract.toolBudget.maxToolCalls <= testCase.expected.maxToolCalls, `${testCase.id}: tool budget`);
  assert.equal(contract.progressPlan.backgroundContinuation, testCase.expected.background, `${testCase.id}: background continuation`);
  assert.equal(contract.conversationPlan.answerStrategy, testCase.expected.conversation.answerStrategy, `${testCase.id}: conversation answer strategy`);
  assert.equal(contract.conversationPlan.evidenceMode, testCase.expected.conversation.evidenceMode, `${testCase.id}: conversation evidence mode`);
  assert.equal(contract.conversationPlan.refsFirst, true, `${testCase.id}: refs-first conversation plan`);
  assert.equal(contract.conversationPlan.auditHydration, testCase.expected.conversation.auditHydration, `${testCase.id}: audit hydration`);
  assert.equal(contract.conversationPlan.maxInlineEvidenceRefs, testCase.expected.conversation.maxInlineEvidenceRefs, `${testCase.id}: inline evidence budget`);
  assert.equal(contract.presentationPlan.status, testCase.expected.status, `${testCase.id}: presentation status`);
  assert.ok(!contract.presentationPlan.defaultExpandedSections.includes('raw-payload'), `${testCase.id}: raw payload must stay folded`);
  assert.ok(trace.latencyTier === testCase.latencyTier, `${testCase.id}: trace latency tier`);

  for (const phase of phases) {
    assert.equal(typeof contract.progressPlan.phaseDeadlines?.[phase], 'number', `${testCase.id}: missing phase deadline for ${phase}`);
  }

  benchmarkSummary.push({
    id: testCase.id,
    tier: contract.latencyTier,
    firstResultDeadlineMs: contract.progressPlan.firstResultDeadlineMs,
    backgroundAfterMs: contract.progressPlan.backgroundAfterMs,
    maxToolCalls: contract.toolBudget.maxToolCalls,
    conversation: contract.conversationPlan,
    status: contract.presentationPlan.status,
  });
}

const statusFixtures: Array<{ id: string; payload: Record<string, unknown>; expected: ResultPresentationStatus }> = [
  {
    id: 'quick-complete',
    expected: 'complete',
    payload: payloadFixture('Quick result completed.', 'completed'),
  },
  {
    id: 'bounded-partial',
    expected: 'partial',
    payload: payloadFixture('Partial result: one source is missing.', 'partial'),
  },
  {
    id: 'deep-needs-human',
    expected: 'needs-human',
    payload: payloadFixture('Needs human approval before external mutation.', 'needs-human'),
  },
  {
    id: 'background-running',
    expected: 'background-running',
    payload: payloadFixture('First result is ready; continuing in background.', 'background-running'),
  },
  {
    id: 'failure',
    expected: 'failed',
    payload: payloadFixture('Failed with reason: provider unavailable.', 'failed-with-reason'),
  },
];

for (const fixture of statusFixtures) {
  const presentation = materializeResultPresentationContract({ payload: fixture.payload, fallbackTitle: fixture.id });
  assert.equal(presentation.status, fixture.expected, `${fixture.id}: result presentation status`);
  assert.ok(presentation.answerBlocks.length > 0, `${fixture.id}: answer-first block`);
  assert.ok(!presentation.defaultExpandedSections.includes('raw-payload'), `${fixture.id}: raw payload hidden`);
  assert.deepEqual(validateResultPresentationContract(presentation), { ok: true, issues: [] }, `${fixture.id}: valid presentation contract`);
}

console.log(`[ok] harness latency tiers benchmark smoke covered: ${JSON.stringify(benchmarkSummary)}`);

function payloadFixture(message: string, status: string): Record<string, unknown> {
  return {
    status,
    message,
    confidence: status === 'completed' ? 0.88 : 0.55,
    claimType: status,
    evidenceLevel: status,
    claims: [
      {
        id: `${status}-claim`,
        statement: message,
        evidenceRefs: [`artifact::${status}-report`],
        verificationState: status === 'failed-with-reason' ? 'failed' : status === 'partial' ? 'partial' : 'supported',
      },
    ],
    artifacts: [
      {
        id: `${status}-report`,
        type: 'research-report',
        title: `${status} report`,
        path: `.sciforge/smoke/${status}.md`,
      },
    ],
    executionUnits: [
      {
        id: `${status}-unit`,
        status,
        recoverActions: status === 'failed-with-reason' ? ['Retry with a different provider.'] : [],
      },
    ],
  };
}

function profileWithFailurePresentation(): HarnessProfile {
  const base = getHarnessProfile('balanced-default');
  return {
    ...base,
    id: 'latency-smoke.failure',
    callbacks: [
      ...base.callbacks,
      {
        id: 'latency-smoke.failure-presentation',
        version: '0.1.0',
        stages: ['beforeResultPresentation'],
        decide: () => ({
          presentation: {
            primaryMode: 'failure-first',
            status: 'failed',
            defaultExpandedSections: ['answer', 'key-findings', 'next-actions'],
            defaultCollapsedSections: ['process', 'diagnostics', 'raw-payload'],
          },
        }),
      },
    ],
  };
}

import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import type { HarnessInput, HarnessProfileId } from '../../packages/agent-harness/src/contracts';
import {
  assertGoldenTraceSummary,
  summarizeGoldenTrace,
} from '../harness/goldenTraces';
import { collectHarnessExperimentMetrics } from '../harness/metrics';
import {
  assertReplayRecord,
  createHarnessReplayRecord,
} from '../harness/replay';
import {
  capabilityBudgetExhaustionFixture,
  fileGroundedSummaryFixture,
  freshResearchFixture,
  repairAfterValidationFailureFixture,
  silentStreamCancelFixture,
} from '../harness/fixtures/agentHarnessExperimentFixtures';

interface ReplayCase {
  id: string;
  input: HarnessInput;
  profileId: HarnessProfileId;
  refs: Record<string, unknown>;
  golden?: boolean;
}

const runtime = createHarnessRuntime({
  traceIdFactory: (input) => `replay:${input.requestId}:${input.profileId ?? 'balanced-default'}`,
});

const replayCases: ReplayCase[] = [
  {
    id: 'fresh-research.fast-answer',
    input: freshResearchFixture.input,
    profileId: 'fast-answer',
    refs: {
      'paper:crispr-screen-a': { title: 'Fixture CRISPR screen A', citationVerified: true },
      'paper:crispr-screen-b': { title: 'Fixture CRISPR screen B', citationVerified: false },
    },
    golden: true,
  },
  {
    id: 'fresh-research.research-grade',
    input: freshResearchFixture.input,
    profileId: 'research-grade',
    refs: {
      'paper:crispr-screen-a': { title: 'Fixture CRISPR screen A', citationVerified: true },
      'paper:crispr-screen-b': { title: 'Fixture CRISPR screen B', citationVerified: false },
    },
    golden: true,
  },
  {
    id: 'fresh-research.privacy-strict',
    input: freshResearchFixture.input,
    profileId: 'privacy-strict',
    refs: {
      'paper:crispr-screen-a': { title: 'Fixture CRISPR screen A', citationVerified: true },
      'paper:crispr-screen-b': { title: 'Fixture CRISPR screen B', citationVerified: false },
    },
    golden: true,
  },
  {
    id: 'repair-after-validation-failure.debug-repair',
    input: repairAfterValidationFailureFixture.input,
    profileId: 'debug-repair',
    refs: {
      'attempt:previous-success': { artifactRefs: [] },
      'validation:missing-artifact-ref': { code: 'missing_required_artifact' },
    },
    golden: true,
  },
  {
    id: 'capability-budget-exhaustion.fast-answer',
    input: capabilityBudgetExhaustionFixture.input,
    profileId: 'fast-answer',
    refs: {
      'ref:public-digest': { visibility: 'public', digest: 'bounded summary only' },
      'ref:private-upload': { visibility: 'private', blocked: true },
    },
    golden: true,
  },
  {
    id: 'file-grounded-summary.low-cost',
    input: fileGroundedSummaryFixture.input,
    profileId: 'low-cost',
    refs: {
      'file:methods-notes.md': { kind: 'file', digest: 'methods notes fixture' },
      'artifact:sample-metadata-table': { kind: 'table', rows: 3 },
    },
  },
  {
    id: 'silent-stream-cancel.balanced-default',
    input: silentStreamCancelFixture.input,
    profileId: 'balanced-default',
    refs: {
      'run:stalled-agent-42': { status: 'cancel-requested' },
      'trace:stream-heartbeats': { lastEventAgeMs: 65000 },
    },
  },
];

const replaySummaries = [];
const metricsById = new Map<string, ReturnType<typeof collectHarnessExperimentMetrics>>();

for (const replayCase of replayCases) {
  const harnessInput = { ...replayCase.input, profileId: replayCase.profileId };
  const evaluation = await runtime.evaluate(harnessInput);
  const metrics = collectHarnessExperimentMetrics(replayCase.id, harnessInput, evaluation);
  const record = createHarnessReplayRecord({
    id: replayCase.id,
    harnessInput,
    evaluation,
    refs: replayCase.refs,
    metrics,
  });

  assertReplayRecord(record);
  if (replayCase.golden) assertGoldenTraceSummary(replayCase.id, evaluation);

  metricsById.set(replayCase.id, metrics);
  replaySummaries.push(summarizeGoldenTrace(replayCase.id, evaluation));
}

const fastMetrics = requiredMetrics('fresh-research.fast-answer');
const researchMetrics = requiredMetrics('fresh-research.research-grade');
const privacyMetrics = requiredMetrics('fresh-research.privacy-strict');
const repairMetrics = requiredMetrics('repair-after-validation-failure.debug-repair');
const budgetMetrics = requiredMetrics('capability-budget-exhaustion.fast-answer');

assert.ok(fastMetrics.toolCallBudget < researchMetrics.toolCallBudget, 'research profile should allow more tool calls than fast profile');
assert.ok(fastMetrics.latencyBudgetMs < researchMetrics.latencyBudgetMs, 'research profile should allow a wider latency budget than fast profile');
assert.ok(fastMetrics.promptTokenBudget < researchMetrics.promptTokenBudget, 'research profile should allow more prompt context than fast profile');
assert.equal(privacyMetrics.networkCallBudget, 0, 'privacy profile should block network budget');
assert.equal(privacyMetrics.blockedCapabilityCount, 3, 'privacy profile should track blocked capabilities');
assert.equal(repairMetrics.validationFailures, 1, 'repair fixture should expose one validation failure');
assert.equal(repairMetrics.repairAttempts, 2, 'repair fixture should expose repair attempts');
assert.equal(budgetMetrics.toolCallBudget, 0, 'budget exhaustion fixture should keep tool calls at zero');
assert.equal(budgetMetrics.downloadByteBudget, 0, 'budget exhaustion fixture should keep downloads at zero');

console.log(`[ok] agent harness replay/metrics/golden traces covered offline: ${JSON.stringify(replaySummaries.map((summary) => ({
  id: summary.id,
  traceId: summary.traceId,
  stages: summary.stageKeys.length,
  profileId: summary.profileId,
  network: summary.final.toolBudget.maxNetworkCalls,
})))}`);

function requiredMetrics(id: string) {
  const metrics = metricsById.get(id);
  assert.ok(metrics, `missing metrics for ${id}`);
  return metrics;
}

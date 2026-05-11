import assert from 'node:assert/strict';

import { complexMultiTurnFixtures } from '../fixtures/complex-multiturn/suite';
import {
  COMPLEX_MULTITURN_CONTRACT_REPLAY_SUMMARY_SCHEMA_VERSION,
  assertComplexMultiturnReplayResult,
  replayComplexMultiturnFixture,
  summarizeComplexMultiturnReplayContracts,
} from '../harness/complexMultiturnReplay';

const replayFixtureIds = [
  't5-02-continue-after-timeout',
  't10-10-complex-recovery-across-repeated-failures',
  't20-02-continuous-failure-resilience',
  'ts-12-edit-recent-user-message-and-revert',
];

const fixturesById = new Map(complexMultiTurnFixtures.map((fixture) => [fixture.id, fixture]));
const replayResults = [];

for (const fixtureId of replayFixtureIds) {
  const fixture = fixturesById.get(fixtureId);
  assert.ok(fixture, `missing replay fixture ${fixtureId}`);
  const result = replayComplexMultiturnFixture(fixture);
  assertComplexMultiturnReplayResult(fixture, result);
  replayResults.push(result);
}

const replayedTiers = new Set(replayResults.map((result) => result.tier));
for (const tier of ['five-turn', 'ten-turn', 'twenty-turn', 'lifecycle'] as const) {
  assert.ok(replayedTiers.has(tier), `real replay should cover ${tier}`);
}

for (const result of replayResults) {
  assert.equal(result.checkpoints.length, result.turnCount, `${result.fixtureId}: checkpoints`);
  assert.ok(result.metrics.recoverySuccess, `${result.fixtureId}: failure injections should recover`);
  assert.ok(result.benchmarkReport.gateEvaluation?.passed, `${result.fixtureId}: benchmark gates should pass`);
}

const failureReplay = replayResults.find((result) => result.fixtureId === 't5-02-continue-after-timeout');
assert.ok(failureReplay, 'missing failure replay result');
assert.ok(failureReplay.events.some((event) => event.type === 'failure'), 'failure injection should generate failure event');
assert.ok(failureReplay.events.some((event) => event.type === 'recovery-plan'), 'failure injection should generate recovery event');

const lifecycleReplay = replayResults.find((result) => result.tier === 'lifecycle');
assert.ok(lifecycleReplay, 'missing lifecycle replay result');
assert.ok(lifecycleReplay.events.some((event) => event.type === 'resume-preflight'), 'lifecycle replay should generate resume-preflight event');
assert.ok(lifecycleReplay.events.some((event) => event.type === 'history-branch-record'), 'history mutation lifecycle replay should generate branch record');

const contractSummary = summarizeComplexMultiturnReplayContracts(complexMultiTurnFixtures);
assert.equal(contractSummary.schemaVersion, COMPLEX_MULTITURN_CONTRACT_REPLAY_SUMMARY_SCHEMA_VERSION, 'contract replay summary schema');
assert.equal(contractSummary.fixtureCount, 67, 'all 67 fixtures should have contract-only replay summary');
assert.deepEqual(contractSummary.countsByTier, {
  'five-turn': 10,
  'ten-turn': 12,
  'twenty-turn': 15,
  lifecycle: 30,
});
assert.equal(contractSummary.totalStateDigestCheckpoints, contractSummary.totalTurns, 'contract summary should account for every checkpoint');
assert.ok(contractSummary.totalFailureInjections > 67, 'contract summary should include full failure-injection inventory');
assert.equal(contractSummary.totalExpectedRecoveryEvents, contractSummary.totalFailureInjections, 'every injected failure should expect recovery');
assert.ok(contractSummary.fixtures.every((summary) => summary.expectedEventTypes.includes('state-digest')), 'every fixture requires state digest replay');
assert.ok(contractSummary.fixtures.filter((summary) => summary.lifecycleReplayRequired).length >= 45, '20-turn and lifecycle fixtures require resume preflight');

console.log(`[ok] complex multiturn replay covered real fixture runners and contract summaries: ${JSON.stringify({
  replayed: replayResults.map((result) => ({
    id: result.fixtureId,
    tier: result.tier,
    turns: result.turnCount,
    events: result.events.length,
    qualityScore: result.benchmarkReport.timeline.summary.qualityScore,
  })),
  contractSummary: {
    fixtures: contractSummary.fixtureCount,
    turns: contractSummary.totalTurns,
    failures: contractSummary.totalFailureInjections,
    countsByTier: contractSummary.countsByTier,
  },
})}`);

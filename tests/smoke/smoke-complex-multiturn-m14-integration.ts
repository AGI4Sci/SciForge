import assert from 'node:assert/strict';

import { evaluateHarness } from '../../packages/agent-harness/src/runtime';
import { buildComplexMultiturnPresentation } from '../../src/runtime/gateway/complex-multiturn-presentation';
import { complexMultiTurnFixtures } from '../fixtures/complex-multiturn/suite';
import { projectComplexFixtureToHarnessInput, traceCoverageForComplexFixture } from '../harness/complexMultiturnHarnessProjection';
import { replayComplexMultiturnFixture, summarizeComplexMultiturnReplayFixtures } from '../harness/complexMultiturnReplay';

const fixtureByTier = [
  complexMultiTurnFixtures.find((fixture) => fixture.tier === 'five-turn'),
  complexMultiTurnFixtures.find((fixture) => fixture.tier === 'ten-turn'),
  complexMultiTurnFixtures.find((fixture) => fixture.tier === 'twenty-turn'),
  complexMultiTurnFixtures.find((fixture) => fixture.tier === 'lifecycle'),
].filter((fixture): fixture is typeof complexMultiTurnFixtures[number] => Boolean(fixture));

assert.equal(fixtureByTier.length, 4, 'M14 smoke needs one fixture from each tier');

for (const fixture of fixtureByTier) {
  const projection = projectComplexFixtureToHarnessInput(fixture);
  const evaluation = await evaluateHarness(projection.harnessInput, {
    traceIdFactory: (input) => `complex-multiturn:${input.requestId}`,
  });
  const coverage = traceCoverageForComplexFixture(fixture, evaluation);
  assert.equal(coverage.ok, true, `${fixture.id}: harness trace coverage`);
  assert.equal(evaluation.contract.traceRef, evaluation.trace.traceId, `${fixture.id}: contract trace ref`);
  assert.equal(evaluation.contract.latencyTier, fixture.latencyBudget.tier, `${fixture.id}: latency tier survives harness evaluation`);

  const replay = replayComplexMultiturnFixture(fixture);
  assert.deepEqual(replay.coverage.missingRequiredEvents, [], `${fixture.id}: replay required events`);
  assert.equal(replay.report.gateEvaluation?.passed, true, `${fixture.id}: replay gates`);
  assert.equal(replay.checkpoints.length, fixture.turns.length, `${fixture.id}: checkpoint per turn`);

  const presentation = buildComplexMultiturnPresentation({
    id: `presentation:${fixture.id}`,
    title: fixture.title,
    stateDigest: replay.checkpoints.at(-1)?.digest,
    benchmarkReport: replay.report,
    artifactRefs: fixture.artifactExpectations.requiredObjectRefs,
    stateAuthority: fixture.lifecycle?.stateAuthority ?? 'fixture-state-digest',
    historyMutationMode: fixture.historyMutation.mode,
    rawDiagnosticRefs: [`trace:${evaluation.trace.traceId}`],
    needsUserChoice: fixture.lifecycle?.conflictResolution === 'needs-human',
  });
  assert.ok(presentation.answerBlocks.length > 0, `${fixture.id}: presentation answer blocks`);
  assert.ok(presentation.nextActions.length > 0, `${fixture.id}: presentation next actions`);
  assert.ok(presentation.diagnosticsRefs.every((ref) => ref.foldedByDefault), `${fixture.id}: diagnostics folded`);
}

const aggregate = summarizeComplexMultiturnReplayFixtures(complexMultiTurnFixtures);
assert.equal(aggregate.fixtureCount, 67, 'all M13 fixtures are replayable through M14 runner');
assert.deepEqual(aggregate.missingRequiredEventFixtures, [], 'all fixtures cover required replay events');

console.log(`[ok] M14 complex multiturn harness/replay/presentation integration covered ${fixtureByTier.length} tier samples and ${aggregate.fixtureCount} replay summaries`);

import assert from 'node:assert/strict';

import { createHarnessRuntime } from '../../packages/agent-harness/src/runtime';
import { complexMultiTurnFixtures } from '../fixtures/complex-multiturn/suite';
import { collectHarnessExperimentMetrics } from '../harness/metrics';
import {
  assertReplayRecord,
  createHarnessReplayRecord,
} from '../harness/replay';
import {
  assertComplexMultiturnHarnessTraceProjection,
  projectComplexMultiturnFixtureToHarnessInputs,
} from '../harness/complexMultiturnHarnessProjection';

const runtime = createHarnessRuntime({
  traceIdFactory: (input) => `trace:${input.requestId ?? 'missing-request-id'}`,
});

let projectionCount = 0;
let turnCount = 0;
const fixtureSummaries = [];
const coveredReplayEvents = new Set<string>();
const coveredReplayMetrics = new Set<string>();

for (const fixture of complexMultiTurnFixtures) {
  const projections = projectComplexMultiturnFixtureToHarnessInputs(fixture);
  assert.equal(projections.length, fixture.turns.length, `${fixture.id}: every turn must have a harness projection`);
  turnCount += fixture.turns.length;

  for (const projection of projections) {
    const sourceTurn = fixture.turns.find((turn) => turn.id === projection.turnId);
    assert.ok(sourceTurn, `${projection.id}: source turn missing`);
    assert.notEqual(projection.harnessInput.prompt, sourceTurn.userPrompt, `${projection.id}: projection must not depend on concrete prompt text`);

    const evaluation = await runtime.evaluate(projection.harnessInput);
    const traceAsText = JSON.stringify(evaluation.trace);
    assert.ok(!traceAsText.includes(sourceTurn.userPrompt), `${projection.id}: trace must not inline concrete prompt text`);

    const metrics = collectHarnessExperimentMetrics(projection.id, projection.harnessInput, evaluation);
    const record = createHarnessReplayRecord({
      id: projection.id,
      harnessInput: projection.harnessInput,
      evaluation,
      refs: projection.refs,
      metrics,
    });

    assertReplayRecord(record);
    assertComplexMultiturnHarnessTraceProjection(projection, evaluation);

    for (const ref of projection.traceExpectation.requiredReplayEventRefs) coveredReplayEvents.add(ref.split(':').at(-1) ?? ref);
    for (const ref of projection.traceExpectation.requiredMetricRefs) coveredReplayMetrics.add(ref.split(':').at(-1) ?? ref);
    projectionCount += 1;
  }

  fixtureSummaries.push({
    id: fixture.id,
    tier: fixture.tier,
    turns: fixture.turns.length,
    replayEvents: fixture.replayTrace.requiredEvents.length,
    replayMetrics: fixture.replayTrace.requiredMetrics.length,
  });
}

assert.equal(complexMultiTurnFixtures.length, 67, 'complex multi-turn suite fixture count changed unexpectedly');
assert.equal(projectionCount, turnCount, 'projection count must match source turn count');
assert.ok(coveredReplayEvents.has('turn-start'), 'trace projection must cover turn-start events');
assert.ok(coveredReplayEvents.has('state-digest'), 'trace projection must cover state-digest events');
assert.ok(coveredReplayEvents.has('first-readable-result'), 'trace projection must cover first-readable-result events');
assert.ok(coveredReplayEvents.has('final-summary'), 'trace projection must cover final-summary events');
assert.ok(coveredReplayMetrics.has('firstReadableMs'), 'trace projection must cover firstReadableMs metric');
assert.ok(coveredReplayMetrics.has('artifactReferenceAccuracy'), 'trace projection must cover artifactReferenceAccuracy metric');
assert.ok(coveredReplayMetrics.has('sideEffectDuplicationRate'), 'trace projection must cover sideEffectDuplicationRate metric');

console.log(`[ok] complex multi-turn harness trace projections covered offline: ${JSON.stringify({
  fixtures: complexMultiTurnFixtures.length,
  turns: turnCount,
  projections: projectionCount,
  sample: fixtureSummaries.slice(0, 3),
})}`);

import assert from 'node:assert/strict';

import {
  COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION,
  type AllowedTool,
  type ComplexFixtureTier,
  type ComplexMultiTurnFixture,
  type FailureInjectionMode,
  type HistoryMutationMode,
  type SuccessOutcome,
} from '../fixtures/complex-multiturn/contract';
import { complexMultiTurnFixtures } from '../fixtures/complex-multiturn/suite';

const expectedCounts: Record<ComplexFixtureTier, number> = {
  'five-turn': 10,
  'ten-turn': 12,
  'twenty-turn': 15,
  lifecycle: 30,
};

const allowedTools: Set<AllowedTool> = new Set([
  'agentserver-generation',
  'artifact-resolver',
  'artifact-reader',
  'artifact-writer',
  'workspace-read',
  'workspace-write',
  'command-runner',
  'python-task',
  'literature-search',
  'metadata-fetch',
  'pdf-download',
  'schema-validator',
  'runtime-state',
  'execution-unit-reader',
  'verifier',
  'background-continuation',
  'browser-session-state',
]);

const requiredFailureModes: FailureInjectionMode[] = [
  'timeout',
  'empty_search_result',
  'download_unavailable',
  'schema_validation_failure',
  'backend_delay',
  'tool_stderr',
];

const requiredOutcomes: SuccessOutcome[] = [
  'success',
  'partial',
  'failure',
  'recovery',
  'background-revision',
  'revert',
  'continue',
  'branch',
  'merge',
];

const requiredHistoryModes: HistoryMutationMode[] = ['none', 'revert', 'continue', 'branch', 'merge'];

assert.equal(complexMultiTurnFixtures.length, 67, 'H017 suite should define exactly the requested 67 fixtures for this worker slice');

const ids = new Set<string>();
const counts = new Map<ComplexFixtureTier, number>();
const coveredFailures = new Set<FailureInjectionMode>();
const coveredOutcomes = new Set<SuccessOutcome>();
const coveredHistoryModes = new Set<HistoryMutationMode>();

for (const fixture of complexMultiTurnFixtures) {
  validateBaseFixture(fixture);
  ids.add(fixture.id);
  counts.set(fixture.tier, (counts.get(fixture.tier) ?? 0) + 1);
  for (const failure of fixture.failureInjections) coveredFailures.add(failure.mode);
  for (const criterion of fixture.successCriteria) coveredOutcomes.add(criterion.outcome);
  coveredHistoryModes.add(fixture.historyMutation.mode);

  if (fixture.tier === 'five-turn') validateTurnCount(fixture, 5);
  if (fixture.tier === 'ten-turn') validateTenTurnFixture(fixture);
  if (fixture.tier === 'twenty-turn') validateTwentyTurnFixture(fixture);
  if (fixture.tier === 'lifecycle') validateLifecycleFixture(fixture);
  if (fixture.sourceTaskId === 'T10-04') validateFieldMappingFixture(fixture);
}

assert.equal(ids.size, complexMultiTurnFixtures.length, 'fixture ids must be unique');

for (const [tier, expectedCount] of Object.entries(expectedCounts) as Array<[ComplexFixtureTier, number]>) {
  assert.equal(counts.get(tier), expectedCount, `${tier}: fixture count`);
}

for (const mode of requiredFailureModes) {
  assert.ok(coveredFailures.has(mode), `suite should cover failure injection mode ${mode}`);
}

for (const outcome of requiredOutcomes) {
  assert.ok(coveredOutcomes.has(outcome), `suite should cover success outcome ${outcome}`);
}

for (const mode of requiredHistoryModes) {
  assert.ok(coveredHistoryModes.has(mode), `suite should cover history mutation mode ${mode}`);
}

console.log(`[ok] complex multi-turn fixture suite contract passed: ${JSON.stringify(Object.fromEntries(counts))}`);

function validateBaseFixture(fixture: ComplexMultiTurnFixture): void {
  assert.equal(fixture.schemaVersion, COMPLEX_MULTI_TURN_FIXTURE_SCHEMA_VERSION, `${fixture.id}: schema version`);
  assert.match(fixture.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${fixture.id}: stable slug id`);
  assert.match(fixture.sourceTaskId, /^(T5|T10|T20|TS)-\d{2}$/, `${fixture.id}: source task id`);
  assert.ok(fixture.title.length > 0, `${fixture.id}: title`);
  assert.ok(fixture.objectives.length >= 2, `${fixture.id}: objectives`);
  assert.ok(fixture.turns.length > 0, `${fixture.id}: turns`);
  assert.ok(fixture.allowedTools.length > 0, `${fixture.id}: allowed tools`);
  assert.ok(fixture.expectedState.taskGraph.currentGoal.length > 0, `${fixture.id}: expected state current goal`);
  assert.ok(fixture.expectedState.requiredStateExplanation.length >= 4, `${fixture.id}: state explanation coverage`);
  assert.ok(fixture.latencyBudget.maxFirstReadableMs > 0, `${fixture.id}: latency budget first readable`);
  assert.ok(fixture.latencyBudget.maxTurnCompletionMs >= fixture.latencyBudget.maxFirstReadableMs, `${fixture.id}: latency budget ordering`);
  assert.ok(fixture.memoryExpectations.stateDigestRequired, `${fixture.id}: state digest required`);
  assert.ok(fixture.memoryExpectations.reusableRefs.length > 0, `${fixture.id}: reusable refs`);
  assert.ok(fixture.memoryExpectations.forbiddenRepeatedWork.length >= 3, `${fixture.id}: repeated work guard`);
  assert.ok(fixture.artifactExpectations.expectedArtifacts.length >= 2, `${fixture.id}: artifact expectations`);
  assert.ok(fixture.artifactExpectations.requiredObjectRefs.length >= 3, `${fixture.id}: required object refs`);
  assert.ok(fixture.artifactExpectations.identityAssertions.length >= 2, `${fixture.id}: identity assertions`);
  assert.ok(fixture.successCriteria.length > 0, `${fixture.id}: success criteria`);
  assert.ok(fixture.replayTrace.requiredEvents.includes('state-digest'), `${fixture.id}: replay trace state digest`);
  assert.ok(fixture.replayTrace.requiredEvents.includes('first-readable-result'), `${fixture.id}: replay trace first result`);
  assert.ok(fixture.replayTrace.requiredMetrics.includes('artifactReferenceAccuracy'), `${fixture.id}: artifact accuracy metric`);
  assert.ok(fixture.presentationSnapshots.length >= 3, `${fixture.id}: presentation snapshots`);
  assert.ok(fixture.latencySummary.redundantWorkRateMax < 0.2, `${fixture.id}: redundant work ceiling`);
  assert.ok(fixture.behaviorNotes.length > 0, `${fixture.id}: behavior notes`);

  for (const tool of fixture.allowedTools) {
    assert.ok(allowedTools.has(tool), `${fixture.id}: unknown allowed tool ${tool}`);
  }

  const failureIds = new Set(fixture.failureInjections.map((failure) => failure.id));
  for (const failure of fixture.failureInjections) {
    assert.ok(failure.turnIndex >= 1 && failure.turnIndex <= fixture.turns.length, `${fixture.id}: failure ${failure.id} turn index`);
    assert.ok(failure.target.length > 0, `${fixture.id}: failure ${failure.id} target`);
    assert.ok(failure.expectedRecovery.length > 0, `${fixture.id}: failure ${failure.id} recovery`);
    assert.ok(failure.reusableEvidence.length > 0, `${fixture.id}: failure ${failure.id} reusable evidence`);
    assert.equal(failure.shouldAvoidDuplicateSideEffect, true, `${fixture.id}: failure ${failure.id} duplicate side-effect guard`);
  }

  for (const turn of fixture.turns) {
    assert.equal(turn.id, `${fixture.id}:turn-${turn.index}`, `${fixture.id}: turn id`);
    assert.ok(turn.index >= 1 && turn.index <= fixture.turns.length, `${fixture.id}: turn index`);
    assert.ok(turn.userPrompt.includes(fixture.sourceTaskId), `${fixture.id}: turn prompt should retain source task id`);
    assert.ok(turn.expectedStateDelta.length > 0, `${fixture.id}: turn ${turn.index} state delta`);
    assert.ok(turn.expectedToolUse.every((tool) => fixture.allowedTools.includes(tool)), `${fixture.id}: turn ${turn.index} tool subset`);
    assert.ok(turn.maxFirstResultTimeMs <= fixture.latencyBudget.maxFirstReadableMs, `${fixture.id}: turn ${turn.index} first result SLA`);
    assert.ok(turn.maxRepeatedExploration <= fixture.latencyBudget.maxRepeatedExploration, `${fixture.id}: turn ${turn.index} repeated exploration`);
    for (const failureId of turn.failureInjectionIds) {
      assert.ok(failureIds.has(failureId), `${fixture.id}: turn ${turn.index} references known failure ${failureId}`);
    }
  }

  for (const snapshot of fixture.presentationSnapshots) {
    assert.ok(snapshot.turnIndex >= 1 && snapshot.turnIndex <= fixture.turns.length, `${fixture.id}: snapshot turn index`);
    assert.ok(snapshot.requiredSections.length > 0, `${fixture.id}: snapshot sections`);
    assert.ok(snapshot.forbiddenSectionsExpanded.includes('raw trace'), `${fixture.id}: raw trace should stay folded`);
  }
}

function validateFieldMappingFixture(fixture: ComplexMultiTurnFixture): void {
  const mappingRef = `artifact:${fixture.id}:field-mapping`;
  assert.ok(fixture.artifactExpectations.expectedArtifacts.includes(mappingRef), `${fixture.id}: field mapping artifact expected`);
  assert.ok(fixture.artifactExpectations.requiredObjectRefs.includes(mappingRef), `${fixture.id}: field mapping object ref required`);
  assert.ok(
    fixture.artifactExpectations.artifactLineage.some((lineage) => lineage.includes(mappingRef)),
    `${fixture.id}: field mapping lineage retained`,
  );
  assert.ok(
    fixture.artifactExpectations.identityAssertions.some((assertion) => /source table refs.*dataRef\/path.*column identity.*provenance/i.test(assertion)),
    `${fixture.id}: field mapping identity assertion`,
  );
  assert.ok(fixture.allowedTools.includes('workspace-read'), `${fixture.id}: field mapping requires source table reads by ref`);
  assert.ok(fixture.allowedTools.includes('artifact-writer'), `${fixture.id}: field mapping artifact must be materialized`);
}

function validateTurnCount(fixture: ComplexMultiTurnFixture, expected: number): void {
  assert.equal(fixture.turns.length, expected, `${fixture.id}: turn count`);
}

function validateTenTurnFixture(fixture: ComplexMultiTurnFixture): void {
  validateTurnCount(fixture, 10);
  assert.ok(countMarkedTurns(fixture, 'scopeChange') >= 2, `${fixture.id}: at least two scope changes`);
  assert.ok(fixture.failureInjections.length >= 1, `${fixture.id}: at least one failure injection`);
  assert.ok(countMarkedTurns(fixture, 'artifactReferenceFollowup') >= 1, `${fixture.id}: artifact follow-up`);
  assert.ok(countMarkedTurns(fixture, 'recoveryAction') + countMarkedTurns(fixture, 'backgroundContinuation') >= 1, `${fixture.id}: recovery or background`);
}

function validateTwentyTurnFixture(fixture: ComplexMultiTurnFixture): void {
  validateTurnCount(fixture, 20);
  assert.ok(countMarkedTurns(fixture, 'scopeChange') >= 4, `${fixture.id}: at least four scope changes`);
  assert.ok(fixture.failureInjections.length >= 3, `${fixture.id}: at least three failure injections`);
  assert.ok(countMarkedTurns(fixture, 'backgroundContinuation') >= 2, `${fixture.id}: two background continuations`);
  assert.ok(countMarkedTurns(fixture, 'artifactIdentityCheck') >= 2, `${fixture.id}: artifact identity checks`);
  assert.ok(countMarkedTurns(fixture, 'contextCompactionOrResume') >= 1, `${fixture.id}: compaction or resume marker`);
  assert.ok(fixture.replayTrace.requiredEvents.includes('resume-preflight'), `${fixture.id}: resume preflight trace`);
}

function validateLifecycleFixture(fixture: ComplexMultiTurnFixture): void {
  validateTurnCount(fixture, 5);
  assert.ok(fixture.lifecycle, `${fixture.id}: lifecycle metadata`);
  assert.ok(fixture.lifecycle.resumeSource.length > 0, `${fixture.id}: resume source`);
  assert.ok(fixture.lifecycle.stateAuthority.length > 0, `${fixture.id}: state authority`);
  assert.ok(fixture.lifecycle.sideEffectPolicy.length > 0, `${fixture.id}: side effect policy`);
  assert.equal(fixture.lifecycle.historyMutationMode, fixture.historyMutation.mode, `${fixture.id}: history mutation metadata agrees`);
  assert.ok(fixture.lifecycle.lastDurableTurn > 0, `${fixture.id}: durable turn`);
  assert.ok(fixture.lifecycle.lastStableCheckpointRef.startsWith('checkpoint:'), `${fixture.id}: checkpoint ref`);
  assert.ok(fixture.lifecycle.artifactLineageExpectation.length >= 2, `${fixture.id}: artifact lineage`);
  assert.ok(fixture.lifecycle.freshnessChecks.length >= 3, `${fixture.id}: freshness checks`);
  assert.ok(countMarkedTurns(fixture, 'lifecycleEvent') >= 1, `${fixture.id}: lifecycle event marker`);
  assert.ok(countMarkedTurns(fixture, 'contextCompactionOrResume') >= 1, `${fixture.id}: resume marker`);
  assert.equal(fixture.memoryExpectations.staleCheckRequired, true, `${fixture.id}: stale check required`);
  assert.ok(fixture.replayTrace.requiredEvents.includes('resume-preflight'), `${fixture.id}: resume preflight trace`);
  assert.ok(['read-only', 'resume-idempotent-only', 'require-human-confirmation', 'block-unknown-side-effects', 'fork-before-write', 'serial-ordering-required'].includes(fixture.lifecycle.sideEffectPolicy), `${fixture.id}: side effect policy known`);
}

function countMarkedTurns(fixture: ComplexMultiTurnFixture, marker: keyof ComplexMultiTurnFixture['turns'][number]['markers']): number {
  return fixture.turns.filter((turn) => turn.markers[marker]).length;
}

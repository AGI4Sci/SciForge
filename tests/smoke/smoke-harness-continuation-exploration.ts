import assert from 'node:assert/strict';

import {
  buildExplorationDedupKey,
  createBackgroundContinuationRecord,
  createBackgroundContinuationRevision,
  createFirstResultRecord,
  createHarnessRuntime,
  getContinuationPolicy,
  getExplorationPolicy,
  isDuplicateExploration,
  presentationStatusForFirstResult,
  shouldEarlyStopExploration,
  topKForActivity,
} from '../../packages/agent-harness/src';
import type { LatencyTier } from '../../packages/agent-harness/src';

const runtime = createHarnessRuntime();
const latencyTiers: LatencyTier[] = ['instant', 'quick', 'bounded', 'deep', 'background'];
const summaries = [];

for (const latencyTier of latencyTiers) {
  const evaluation = await runtime.evaluate({
    requestId: `continuation-exploration-${latencyTier}`,
    latencyTier,
    prompt: `Smoke ${latencyTier} first result and exploration policy.`,
  });
  const { contract } = evaluation;
  const continuation = getContinuationPolicy(latencyTier, contract.progressPlan);
  const exploration = getExplorationPolicy(latencyTier);

  assert.equal(continuation.latencyTier, latencyTier, `${latencyTier}: continuation tier`);
  assert.equal(continuation.firstResultDeadlineMs, contract.progressPlan.firstResultDeadlineMs, `${latencyTier}: first result SLA follows progress plan`);
  assert.equal(continuation.backgroundAfterMs, contract.progressPlan.backgroundAfterMs, `${latencyTier}: background threshold follows progress plan`);
  assert.ok(continuation.firstResultKinds.includes('answer'), `${latencyTier}: answer can be first result`);
  assert.ok(continuation.firstResultKinds.includes('failure-reason'), `${latencyTier}: failure reason can be first result`);
  assert.ok(continuation.provenanceRequired, `${latencyTier}: provenance is required`);
  assert.ok(continuation.revisionRequired, `${latencyTier}: background output must revise rather than overwrite`);

  const firstResult = createFirstResultRecord({
    id: `first-${latencyTier}`,
    requestId: `request-${latencyTier}`,
    latencyTier,
    kind: latencyTier === 'instant' ? 'answer' : 'candidate-list',
    createdAtMs: 1000,
    deadlineMs: continuation.firstResultDeadlineMs,
    elapsedMs: Math.min(continuation.firstResultDeadlineMs, 10000),
    presentationRef: `result-presentation:${latencyTier}:v1`,
    artifactRefs: ['artifact://draft'],
    evidenceRefs: ['evidence://summary'],
  });
  assert.equal(firstResult.schemaVersion, 'sciforge.first-result-record.v1', `${latencyTier}: first result schema`);
  assert.ok(firstResult.deadlineMs <= continuation.backgroundAfterMs, `${latencyTier}: first result comes before background threshold`);
  assert.equal(presentationStatusForFirstResult('failure-reason', latencyTier), 'failed', `${latencyTier}: failure first result status`);

  if (continuation.backgroundEnabled) {
    const revision = createBackgroundContinuationRevision({
      id: `revision-${latencyTier}-1`,
      revision: 1,
      kind: 'evidence-added',
      createdAtMs: 2000,
      summary: 'Additional evidence was added after the first result.',
      presentationRef: `result-presentation:${latencyTier}:v2`,
      evidenceRefs: ['evidence://late-source'],
      provenanceRefs: ['trace://continuation'],
    });
    const background = createBackgroundContinuationRecord({
      id: `background-${latencyTier}`,
      latencyTier,
      foregroundResultId: firstResult.id,
      createdAtMs: 1500,
      reason: 'Foreground budget reached; continuing evidence collection in background.',
      provenanceRefs: ['trace://first-result'],
      revisions: [revision],
    });
    assert.equal(background.schemaVersion, 'sciforge.background-continuation-record.v1', `${latencyTier}: background schema`);
    assert.equal(background.foregroundResultId, firstResult.id, `${latencyTier}: background links first result`);
    assert.notEqual(background.revisions[0]?.presentationRef, firstResult.presentationRef, `${latencyTier}: revision does not overwrite original presentation`);
    assert.ok(background.provenanceRefs.length > 0, `${latencyTier}: background provenance`);
    assert.ok(background.revisions[0]?.provenanceRefs.length, `${latencyTier}: revision provenance`);
  }

  assert.equal(exploration.latencyTier, latencyTier, `${latencyTier}: exploration tier`);
  assert.ok(exploration.earlyStop.requireStopReason, `${latencyTier}: early stop reason required`);
  assert.ok(exploration.earlyStop.remainingUpgradePaths.length > 0, `${latencyTier}: remaining upgrade path is visible`);
  assert.ok(exploration.dedup.enabled, `${latencyTier}: dedup enabled`);
  assert.ok(exploration.dedup.skipDuplicateByDefault, `${latencyTier}: duplicates skip by default`);
  assert.equal(topKForActivity(exploration, 'artifact-scan'), exploration.topK.artifactScan, `${latencyTier}: artifact scan topK accessor`);

  const evidenceStop = shouldEarlyStopExploration(exploration, { evidenceSufficient: true });
  if (exploration.earlyStop.reasons.includes('evidence-sufficient')) {
    assert.equal(evidenceStop.stop, true, `${latencyTier}: evidence sufficiency stops exploration`);
  }
  assert.ok(evidenceStop.remainingUpgradePaths.length > 0, `${latencyTier}: stop exposes upgrade path`);

  const duplicateKey = buildExplorationDedupKey({
    kind: 'query-provider',
    query: '  Same Query ',
    providerId: 'ProviderA',
  });
  assert.equal(duplicateKey, 'query-provider:providera:same query', `${latencyTier}: stable query/provider dedup key`);
  const seenKeys = new Set([duplicateKey!]);
  assert.equal(isDuplicateExploration(exploration, {
    kind: 'query-provider',
    query: 'same query',
    providerId: 'providera',
  }, seenKeys), exploration.dedup.keyKinds.includes('query-provider'), `${latencyTier}: duplicate detector follows policy keys`);

  summaries.push({
    latencyTier,
    firstResultDeadlineMs: continuation.firstResultDeadlineMs,
    backgroundAfterMs: continuation.backgroundAfterMs,
    backgroundEnabled: continuation.backgroundEnabled,
    topK: exploration.topK,
    earlyStopReasons: exploration.earlyStop.reasons,
  });
}

const instant = getExplorationPolicy('instant');
const quick = getExplorationPolicy('quick');
const bounded = getExplorationPolicy('bounded');
const deep = getExplorationPolicy('deep');
const background = getExplorationPolicy('background');

assert.ok(quick.topK.retrieval > instant.topK.retrieval, 'quick widens retrieval topK beyond instant');
assert.ok(bounded.topK.download > quick.topK.download, 'bounded widens download topK beyond quick');
assert.ok(deep.topK.verifier > bounded.topK.verifier, 'deep widens verifier topK beyond bounded');
assert.ok(background.topK.repair > deep.topK.repair, 'background widens repair topK beyond deep');
assert.equal(quick.topK.repair, 0, 'quick avoids repair exploration by default');
assert.equal(deep.earlyStop.stopAfterFirstResultForSidecars, false, 'deep may keep high-value sidecars after first result');
assert.equal(background.earlyStop.stopAfterFirstResultForSidecars, false, 'background may continue sidecars after first result');

console.log(`[ok] harness continuation/exploration smoke covered: ${JSON.stringify(summaries)}`);

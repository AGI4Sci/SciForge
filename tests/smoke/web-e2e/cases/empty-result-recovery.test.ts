import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEmptyResultRecoveryCase,
  EMPTY_RESULT_RECOVERY_CASE_ID,
  verifyEmptyResultRecoveryCase,
  type EmptyResultRecoveryCaseResult,
} from './empty-result-recovery.js';

test('SA-WEB-06 shows recoverable needs-human empty-result instead of a completed report', async () => {
  const result = await buildEmptyResultRecoveryCase();
  const verification = verifyEmptyResultRecoveryCase(result);

  assert.equal(verification.ok, true, verification.failures.join('\n'));
  assert.equal(result.firstInput.browserVisibleState.status, 'needs-human');
  assert.equal(result.firstInput.expected.conversationProjection.visibleAnswer?.status, 'needs-human');
  assert.equal(result.firstInput.expected.conversationProjection.visibleAnswer?.diagnostic, 'empty-result');
  assert.ok(result.firstInput.expected.conversationProjection.recoverActions.includes('broaden-query'));
  assert.equal(result.firstInput.expected.artifactDelivery.primaryArtifactRefs.length, 0);
  assert.equal(result.firstInput.expected.artifactDelivery.supportingArtifactRefs.length, 0);
  assert.notEqual(result.firstRun.resultRun.status, 'completed');
  assert.match(JSON.stringify(result.firstRun.resultRun), /empty-result/);
});

test('SA-WEB-06 follow-up broadens query and reuses previous failure evidence', async () => {
  const result = await buildEmptyResultRecoveryCase();
  const verification = verifyEmptyResultRecoveryCase(result);

  assert.equal(verification.ok, true, verification.failures.join('\n'));
  assert.equal(result.recordedRunRequests.length, 2);
  assert.equal(result.recordedRunRequests[0]?.body.query, result.narrowQuery);
  assert.equal(result.recordedRunRequests[1]?.body.query, result.expandedQuery);

  const requestRefs = result.recordedRunRequests[1]?.body.previousFailureEvidenceRefs;
  assert.ok(Array.isArray(requestRefs));
  const followUpEvent = result.followUpRun.events.find((event) => event.providerId === 'sciforge.web-worker.web_search');
  assert.ok(followUpEvent);
  const eventRefs = followUpEvent.previousFailureEvidenceRefs;
  assert.ok(Array.isArray(eventRefs));

  for (const ref of result.firstFailureEvidenceRefs) {
    assert.ok(requestRefs.includes(ref), `follow-up request should include ${ref}`);
    assert.ok(eventRefs.includes(ref), `follow-up event should include ${ref}`);
    assert.ok(result.followUpInput.expected.conversationProjection.auditRefs.includes(ref), `follow-up Projection should include ${ref}`);
  }
});

test('SA-WEB-06 fails focused verification when empty-result is polluted into completed/satisfied state', async () => {
  const result = await buildEmptyResultRecoveryCase();
  const polluted = structuredClone(result) as EmptyResultRecoveryCaseResult;

  polluted.firstInput.browserVisibleState.status = 'satisfied';
  if (polluted.firstInput.expected.conversationProjection.visibleAnswer) {
    polluted.firstInput.expected.conversationProjection.visibleAnswer.status = 'satisfied';
    polluted.firstInput.expected.conversationProjection.visibleAnswer.text = 'Completed report is available.';
  }
  polluted.firstRun.resultRun.status = 'completed';

  const verification = verifyEmptyResultRecoveryCase(polluted);

  assert.equal(verification.ok, false);
  assert.match(verification.failures.join('\n'), /needs-human/);
  assert.match(verification.failures.join('\n'), /completed report/);
});

console.log(`[ok] ${EMPTY_RESULT_RECOVERY_CASE_ID} covers empty-result recovery and follow-up failure evidence reuse`);

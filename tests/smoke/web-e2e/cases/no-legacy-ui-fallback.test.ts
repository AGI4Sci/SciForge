import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNoLegacyUiFallbackCase,
  legacyRawTerminalText,
  noLegacyUiFallbackVerifierInput,
  NO_LEGACY_UI_FALLBACK_CASE_ID,
  projectionWaitingText,
  verifyNoLegacyUiFallbackCase,
  type NoLegacyUiFallbackCaseResult,
} from './no-legacy-ui-fallback.js';

test('SA-WEB-14 quarantines projectionless legacy raw results to audit/debug', async () => {
  const result = await buildNoLegacyUiFallbackCase();
  const verification = verifyNoLegacyUiFallbackCase(result);

  assert.equal(verification.ok, true, verification.failures.join('\n'));
  assert.equal(result.verifierInput.browserVisibleState.status, 'needs-human');
  assert.equal(result.verifierInput.browserVisibleState.visibleAnswerText, projectionWaitingText);
  assert.equal(result.verifierInput.expected.conversationProjection.visibleAnswer?.status, 'needs-human');
  assert.equal(result.verifierInput.expected.conversationProjection.visibleAnswer?.diagnostic, 'missing-conversation-projection');
  assert.deepEqual(result.verifierInput.browserVisibleState.visibleArtifactRefs, []);
  assert.equal(JSON.stringify(result.verifierInput.browserVisibleState).includes(legacyRawTerminalText), false);
  assert.equal(result.auditDebugState.rawResultPresentationText, legacyRawTerminalText);
  assert.equal(result.auditDebugState.rawResponseText, legacyRawTerminalText);
});

test('SA-WEB-14 fails when legacy raw resultPresentation is rendered as the terminal main result', async () => {
  const result = await buildNoLegacyUiFallbackCase();
  const polluted: NoLegacyUiFallbackCaseResult = {
    ...result,
    verifierInput: noLegacyUiFallbackVerifierInput(result, {
      status: 'satisfied',
      visibleAnswerText: legacyRawTerminalText,
    }),
  };

  const verification = verifyNoLegacyUiFallbackCase(polluted);

  assert.equal(verification.ok, false);
  assert.match(verification.failures.join('\n'), /needs-human\/waiting/);
  assert.match(verification.failures.join('\n'), /legacy raw resultPresentation text leaked/);
});

test('SA-WEB-14 fails when the historical session is accidentally seeded with a Projection', async () => {
  const result = await buildNoLegacyUiFallbackCase();
  const polluted = structuredClone(result) as NoLegacyUiFallbackCaseResult;
  const run = polluted.legacySession.runs.find((candidate) => candidate.id === polluted.fixture.runId);
  assert.ok(run);
  run.raw = {
    ...(typeof run.raw === 'object' && run.raw !== null ? run.raw : {}),
    resultPresentation: {
      conversationProjection: polluted.verifierInput.expected.conversationProjection,
    },
  };

  const verification = verifyNoLegacyUiFallbackCase(polluted);

  assert.equal(verification.ok, false);
  assert.match(verification.failures.join('\n'), /must not contain ConversationProjection/);
});

console.log(`[ok] ${NO_LEGACY_UI_FALLBACK_CASE_ID} covers projectionless historical sessions without legacy main UI fallback`);

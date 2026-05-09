import assert from 'node:assert/strict';
import test from 'node:test';

import {
  failedRuntimeVerificationResults,
  isRuntimeVerificationResultArtifact,
  normalizeRuntimeVerificationResults,
  runtimeVerificationResultArtifacts,
  verificationResultFailureActual,
  verificationResultFailureMessages,
} from './verification-result';

test('package verification result contract normalizes nested verifier outputs', () => {
  const results = normalizeRuntimeVerificationResults([
    [{ id: 'schema', verdict: 'pass', confidence: 0.88, evidenceRefs: ['trace:schema'] }],
    { id: 'human', verdict: 'needs-human', reason: 'Manual approval required.', repairHints: ['Ask for approval.'] },
    { verdict: 'not-a-verdict' },
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0]?.verdict, 'pass');
  assert.equal(results[1]?.critique, 'Manual approval required.');
  assert.deepEqual(results[1]?.repairHints, ['Ask for approval.']);
});

test('package verification result contract exposes fail-closed verifier failure details', () => {
  const value = {
    id: 'schema',
    verdict: 'fail',
    confidence: 0.95,
    critique: 'Required field missing.',
    evidenceRefs: ['file:.sciforge/verifications/schema.json'],
    repairHints: ['Regenerate the artifact.'],
  };

  assert.equal(failedRuntimeVerificationResults(value).length, 1);
  assert.match(verificationResultFailureMessages(value)[0] ?? '', /verdict=fail: Required field missing/);
  assert.deepEqual(verificationResultFailureActual(value)[0], {
    id: 'schema',
    verdict: 'fail',
    critique: 'Required field missing.',
    evidenceRefs: ['file:.sciforge/verifications/schema.json'],
    repairHints: ['Regenerate the artifact.'],
  });
});

test('package verification result contract owns verification artifact filtering', () => {
  const artifacts = runtimeVerificationResultArtifacts([
    { id: 'plot', type: 'figure' },
    { id: 'verify-1', type: 'verification-result', dataRef: '.sciforge/verifications/verify-1.json' },
    { id: 'verification-result', data: { verdict: 'pass' } },
  ]);

  assert.equal(isRuntimeVerificationResultArtifact({ type: 'verification-result' }), true);
  assert.deepEqual(artifacts.map((artifact) => artifact.dataRef ?? artifact.id), [
    '.sciforge/verifications/verify-1.json',
    'verification-result',
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { agentVerifierRequestFixture } from './fixture.js';
import { createMockAgentVerifierProvider } from './index.js';

test('mock agent verifier applies rubric over goal, artifact refs and trace refs', async () => {
  const verifier = createMockAgentVerifierProvider();
  const result = await verifier.verify(agentVerifierRequestFixture);

  assert.equal(result.schemaVersion, 'sciforge.agent-verifier-rubric.v1');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.reward, 1);
  assert.deepEqual(result.evidenceRefs.sort(), ['artifact:report-json', 'result:final-answer', 'trace:run-001']);
  assert.equal(result.repairHints.length, 0);
  assert.equal(result.criterionScores.length, agentVerifierRequestFixture.rubric.criteria.length);
});

test('mock agent verifier emits repair hints when required trace refs are absent', async () => {
  const verifier = createMockAgentVerifierProvider();
  const result = await verifier.verify({
    ...agentVerifierRequestFixture,
    traceRefs: [],
  });

  assert.equal(result.verdict, 'needs-human');
  assert.ok(result.reward < 1);
  assert.ok(result.repairHints.some((hint) => hint.includes('trace')));
});

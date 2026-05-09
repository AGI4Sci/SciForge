import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactMatchesReferenceScope } from './artifact-reference-policy';

test('artifact reference scope prefers producer ownership over artifact type aliases', () => {
  assert.equal(artifactMatchesReferenceScope({
    id: 'cross-domain-report',
    type: 'research-report',
    producerScenario: 'omics-analysis',
  }, { skillDomain: 'literature' }), false);

  assert.equal(artifactMatchesReferenceScope({
    id: 'expression-report',
    type: 'paper-list',
    metadata: { skillDomain: 'omics' },
  }, { skillDomain: 'omics' }), true);
});

test('artifact reference scope matches package-owned artifact type aliases', () => {
  assert.equal(artifactMatchesReferenceScope({
    id: 'kg-sequence-summary',
    type: 'sequence-network',
  }, { skillDomain: 'knowledge' }), true);

  assert.equal(artifactMatchesReferenceScope({
    id: 'volcano-plot',
    type: 'volcano-plot',
  }, { skillDomain: 'structure' }), false);
});

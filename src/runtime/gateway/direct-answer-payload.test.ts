import assert from 'node:assert/strict';
import test from 'node:test';

import { coerceWorkspaceTaskPayload } from './direct-answer-payload';
import { schemaErrors } from './tool-payload-contract';

test('workspace task payload coercion accepts common generated JSON shape drift', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Generated a report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'runtime',
    reasoningTrace: ['searched', 'downloaded', 'reported'],
    claims: [{ claim: '20 papers found', evidence: 'arXiv API' }],
    uiManifest: {
      components: [{ id: 'report-viewer', props: { content: '# Report' } }],
    },
    executionUnits: [{ id: 'search', status: 'completed' }],
    artifacts: [
      { id: 'research-report', type: 'research-report', content: '# Report' },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.reasoningTrace, 'searched\ndownloaded\nreported');
  assert.equal(Array.isArray(payload.uiManifest), true);
  assert.deepEqual(schemaErrors(payload), []);
});

test('workspace task payload coercion derives required envelope fields from useful artifacts', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Generated a report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'runtime',
    reasoningTrace: ['searched', 'downloaded', 'reported'],
    displayIntent: 'report',
    uiManifest: {
      components: [{ id: 'report-viewer', props: { content: '# Report' } }],
    },
    executionUnits: [{ id: 'search', status: 'success' }],
    artifacts: [
      { id: 'research-report', type: 'research-report', content: '# Report' },
    ],
  });

  assert.ok(payload);
  assert.equal(payload.claims.length, 1);
  assert.equal(payload.uiManifest[0]?.componentId, 'report-viewer');
  assert.equal(typeof payload.displayIntent, 'object');
  assert.deepEqual(schemaErrors(payload), []);
});

test('workspace task payload coercion drops empty uiManifest artifact refs', () => {
  const payload = coerceWorkspaceTaskPayload({
    message: 'Generated a report.',
    confidence: 0.7,
    claimType: 'survey',
    evidenceLevel: 'runtime',
    reasoningTrace: 'done',
    claims: [],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: '' }],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
  });

  assert.ok(payload);
  assert.equal('artifactRef' in (payload.uiManifest[0] ?? {}), false);
  assert.deepEqual(schemaErrors(payload), []);
});

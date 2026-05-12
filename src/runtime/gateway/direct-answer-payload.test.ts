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

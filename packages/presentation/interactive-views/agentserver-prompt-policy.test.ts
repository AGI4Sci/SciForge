import assert from 'node:assert/strict';
import test from 'node:test';

import { minimalValidInteractiveToolPayloadExample } from './runtime-ui-manifest-policy';

test('interactive view policy owns AgentServer minimal payload default slot selection', () => {
  const selected = minimalValidInteractiveToolPayloadExample({
    skillDomain: 'literature',
    selectedComponentIds: ['report-viewer'],
    expectedArtifactTypes: ['research-report'],
  });
  assert.deepEqual(selected.displayIntent, { primaryView: 'report-viewer' });
  assert.deepEqual(selected.uiManifest, [
    { componentId: 'report-viewer', artifactRef: 'research-report', priority: 1 },
  ]);
  assert.deepEqual(selected.artifacts[0], {
    id: 'research-report',
    type: 'research-report',
    data: { summary: 'Result content goes here.', rows: [] },
  });

  const fallback = minimalValidInteractiveToolPayloadExample({ skillDomain: 'knowledge' });
  assert.deepEqual(fallback.displayIntent, { primaryView: 'generic-artifact-inspector' });
  assert.equal(fallback.uiManifest[0]?.componentId, 'unknown-artifact-inspector');
  assert.equal(fallback.artifacts[0]?.type, 'knowledge-runtime-result');
});

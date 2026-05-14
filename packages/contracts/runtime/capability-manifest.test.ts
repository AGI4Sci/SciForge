import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_CAPABILITY_MANIFESTS,
  validateCapabilityManifestRegistry,
} from './capability-manifest';

test('core capability manifests include standard web and pdf provider contracts', () => {
  assert.deepEqual(validateCapabilityManifestRegistry(CORE_CAPABILITY_MANIFESTS), []);
  const webSearch = CORE_CAPABILITY_MANIFESTS.find((manifest) => manifest.id === 'web_search');
  const webFetch = CORE_CAPABILITY_MANIFESTS.find((manifest) => manifest.id === 'web_fetch');
  const pdfExtract = CORE_CAPABILITY_MANIFESTS.find((manifest) => manifest.id === 'pdf_extract');

  assert.equal(webSearch?.providers[0]?.source, 'agentserver');
  assert.equal(webSearch?.providers[0]?.transport, 'agentserver-worker');
  assert.equal(webSearch?.providers[0]?.workerId, 'backend-server');
  assert.ok(webSearch?.providers[0]?.requiredConfig.includes('web_search.provider.enabled'));
  assert.equal(webFetch?.providers[0]?.source, 'agentserver');
  assert.equal(pdfExtract?.providers[0]?.source, 'local');
  assert.equal(pdfExtract?.providers[0]?.status, 'available');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_CAPABILITY_MANIFESTS,
  validateCapabilityManifestRegistry,
} from './capability-manifest';

test('core capability manifests include platform and local provider contracts', () => {
  assert.deepEqual(validateCapabilityManifestRegistry(CORE_CAPABILITY_MANIFESTS), []);
  const pdfExtract = CORE_CAPABILITY_MANIFESTS.find((manifest) => manifest.id === 'pdf_extract');

  assert.equal(CORE_CAPABILITY_MANIFESTS.some((manifest) => manifest.id === 'web_search'), false);
  assert.equal(CORE_CAPABILITY_MANIFESTS.some((manifest) => manifest.id === 'web_fetch'), false);
  assert.equal(pdfExtract?.providers[0]?.source, 'local');
  assert.equal(pdfExtract?.providers[0]?.status, 'available');
});

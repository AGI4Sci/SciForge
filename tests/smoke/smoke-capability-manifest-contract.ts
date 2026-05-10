import assert from 'node:assert/strict';

import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  compactCapabilityManifestBrief,
  validateCapabilityManifestRegistry,
  validateCapabilityManifestShape,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import { loadCoreCapabilityManifestRegistry } from '../../src/runtime/capability-manifest-registry.js';

const registry = loadCoreCapabilityManifestRegistry();
const coreManifests = registry.manifests;

const ids = coreManifests.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, 'capability manifest ids must be unique');
assert.ok(coreManifests.length >= 8, 'core seed set should cover at least eight platform/capability surfaces');
assert.deepEqual(coreManifests.flatMap(validateCapabilityManifestShape), []);
assert.deepEqual(validateCapabilityManifestRegistry(coreManifests), []);
assert.equal(registry.manifestIds.length, coreManifests.length);
assert.equal(registry.providerIds.length, coreManifests.reduce((total, manifest) => total + manifest.providers.length, 0));
assert.equal(registry.getManifest('runtime.artifact-resolve')?.brief, 'Resolve object references to workspace-backed facts.');
assert.equal(registry.getManifestByProviderId('sciforge.core.runtime.artifact-resolve')?.id, 'runtime.artifact-resolve');
assert.equal(registry.getManifest('runtime.artifact-list')?.lifecycle.sourceRef, 'src/runtime/backend-artifact-tools.ts');
assert.equal(registry.getManifest('runtime.run-resume')?.lifecycle.sourceRef, 'src/runtime/backend-artifact-tools.ts');
assert.equal(registry.getManifestByProviderId('sciforge.core.runtime.artifact-list')?.id, 'runtime.artifact-list');
assert.equal(registry.getManifestByProviderId('sciforge.core.runtime.run-resume')?.id, 'runtime.run-resume');
assert.ok(registry.listBriefs({ kind: 'action' }).length >= 4, 'registry should expose action capability briefs');
assert.ok(registry.listBriefs({ routingTag: 'artifact' }).length >= 4, 'registry should filter briefs by routing tag');

const artifactResolveManifest = registry.getManifest('runtime.artifact-resolve');
assert.ok(artifactResolveManifest, 'runtime.artifact-resolve manifest must exist');
const brief = compactCapabilityManifestBrief(artifactResolveManifest);
assert.equal(brief.contract, CAPABILITY_MANIFEST_CONTRACT_ID);
assert.equal(brief.id, 'runtime.artifact-resolve');
assert.deepEqual(brief.providerIds, ['sciforge.core.runtime.artifact-resolve']);
assert.deepEqual(brief.validatorIds, ['sciforge.core.runtime.artifact-resolve.schema']);
assert.deepEqual(brief.repairFailureCodes, ['contract-invalid']);
assert.equal('inputSchema' in brief, false, 'compact brief must not include full input schema');
assert.equal('examples' in brief, false, 'compact brief must not include examples');

const invalid = {
  ...artifactResolveManifest,
  id: '',
  providers: [],
  sideEffects: ['none', 'workspace-read'],
} as CapabilityManifest;
assert.match(validateCapabilityManifestShape(invalid).join('\n'), /id must be non-empty/);
assert.match(validateCapabilityManifestShape(invalid).join('\n'), /providers must include at least one provider/);
assert.match(validateCapabilityManifestShape(invalid).join('\n'), /sideEffects none cannot be combined/);

console.log('[ok] CapabilityManifest registry loads core manifests with stable providers and compact broker briefs');

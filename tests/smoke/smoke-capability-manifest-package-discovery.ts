import assert from 'node:assert/strict';

import {
  loadCapabilityManifestRegistry,
  loadCoreCapabilityManifestRegistry,
} from '../../src/runtime/capability-manifest-registry.js';
import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';

const coreRegistry = loadCoreCapabilityManifestRegistry();
const packageManifest = discoveredPackageManifest();
const registry = loadCapabilityManifestRegistry({
  packageDiscovery: {
    providerAvailability: [{
      id: 'sciforge.pkg.literature.enrich.remote',
      available: false,
      reason: 'missing SCIFORGE_LITERATURE_API_KEY',
    }],
    packages: [{
      packageName: '@sciforge/pkg-literature-enrich',
      packageRoot: 'packages/skills/literature-enrich',
      manifests: [packageManifest],
      providerAvailability: ['sciforge.pkg.literature.enrich.local'],
    }],
  },
});

assert.equal(registry.manifestIds.length, coreRegistry.manifestIds.length + 1);
assert.equal(registry.getManifest('literature.metadata-enrich')?.ownerPackage, '@sciforge/pkg-literature-enrich');
assert.equal(registry.getManifestByProviderId('sciforge.pkg.literature.enrich.remote')?.id, 'literature.metadata-enrich');
assert.ok(registry.listBriefs({ domain: 'literature' }).some((brief) => brief.id === 'literature.metadata-enrich'));

const audit = registry.compactAudit;
const entry = audit.entries.find((item) => item.id === 'literature.metadata-enrich');
assert.ok(entry, 'package-discovered manifest should be present in compact registry audit');
assert.equal(audit.contract, 'sciforge.capability-manifest-registry-audit.v1');
assert.equal(audit.sourceCounts.core, coreRegistry.manifestIds.length);
assert.equal(audit.sourceCounts.packageDiscovery, 1);
assert.equal(entry.source, 'package-discovery');
assert.equal(entry.packageName, '@sciforge/pkg-literature-enrich');
assert.equal(entry.packageRoot, 'packages/skills/literature-enrich');
assert.deepEqual(entry.sideEffects, ['network', 'external-api']);
assert.equal(entry.risk, 'high');
assert.equal(entry.requiresHumanApproval, true);
assert.deepEqual(entry.requiredConfig, ['SCIFORGE_LITERATURE_API_KEY']);
assert.deepEqual(entry.validatorIds, ['literature.metadata-enrich.schema', 'literature.metadata-enrich.smoke']);
assert.deepEqual(entry.validatorKinds, ['schema', 'smoke']);
assert.deepEqual(entry.repairFailureCodes, ['provider-auth-missing', 'metadata-mismatch']);
assert.deepEqual(entry.repairRecoverActions, ['fallback-local-enrichment', 'request-api-key', 'rerun-metadata-validator']);

const remoteProvider = entry.providerAvailability.find((provider) => provider.providerId === 'sciforge.pkg.literature.enrich.remote');
const localProvider = entry.providerAvailability.find((provider) => provider.providerId === 'sciforge.pkg.literature.enrich.local');
assert.deepEqual(remoteProvider, {
  providerId: 'sciforge.pkg.literature.enrich.remote',
  providerKind: 'package',
  available: false,
  reason: 'missing SCIFORGE_LITERATURE_API_KEY',
  requiredConfig: ['SCIFORGE_LITERATURE_API_KEY'],
});
assert.deepEqual(localProvider, {
  providerId: 'sciforge.pkg.literature.enrich.local',
  providerKind: 'package',
  available: true,
  requiredConfig: [],
});

const auditText = JSON.stringify(audit);
assert.equal(auditText.includes('inputSchema'), false, 'compact audit must keep schemas lazy');
assert.equal(auditText.includes('outputSchema'), false, 'compact audit must keep schemas lazy');
assert.equal(auditText.includes('"examples"'), false, 'compact audit must keep examples lazy');

assert.throws(
  () =>
    loadCapabilityManifestRegistry({
      packageDiscovery: {
        packages: [{
          packageName: '@sciforge/duplicate-runtime',
          manifests: [{ ...packageManifest, id: 'runtime.artifact-read' }],
        }],
      },
    }),
  /duplicate manifest id/,
);

console.log('[ok] capability manifest registry merges package discovery into compact provider audit');

function discoveredPackageManifest(): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: 'literature.metadata-enrich',
    name: 'literature metadata enrich',
    version: '0.1.0',
    ownerPackage: '@sciforge/pkg-literature-enrich',
    kind: 'skill',
    brief: 'Enrich literature metadata with package-provided provider diagnostics.',
    routingTags: ['literature', 'metadata', 'enrich'],
    domains: ['literature', 'research'],
    inputSchema: { type: 'object', required: ['paperRefs'] },
    outputSchema: { type: 'object', required: ['enrichedPaperRefs'] },
    sideEffects: ['network', 'external-api'],
    safety: {
      risk: 'high',
      dataScopes: ['public-web', 'workspace-refs'],
      requiresHumanApproval: true,
    },
    examples: [{
      title: 'enrich paper refs',
      inputRef: 'capability:literature.metadata-enrich/input.example',
      outputRef: 'capability:literature.metadata-enrich/output.example',
    }],
    validators: [
      {
        id: 'literature.metadata-enrich.schema',
        kind: 'schema',
        contractRef: 'literature.metadata-enrich#outputSchema',
        expectedRefs: ['enrichedPaperRefs'],
      },
      {
        id: 'literature.metadata-enrich.smoke',
        kind: 'smoke',
        command: 'npm run smoke:literature-metadata-enrich',
      },
    ],
    repairHints: [
      {
        failureCode: 'provider-auth-missing',
        summary: 'Request package provider credentials or route to the local fallback provider.',
        recoverActions: ['request-api-key', 'fallback-local-enrichment'],
      },
      {
        failureCode: 'metadata-mismatch',
        summary: 'Rerun metadata validator before accepting enriched refs.',
        recoverActions: ['rerun-metadata-validator'],
      },
    ],
    providers: [
      {
        id: 'sciforge.pkg.literature.enrich.remote',
        label: 'remote enrich provider',
        kind: 'package',
        contractRef: 'packages/skills/literature-enrich/providers/remote',
        requiredConfig: ['SCIFORGE_LITERATURE_API_KEY'],
        priority: 1,
      },
      {
        id: 'sciforge.pkg.literature.enrich.local',
        label: 'local enrich provider',
        kind: 'package',
        contractRef: 'packages/skills/literature-enrich/providers/local',
        requiredConfig: [],
        priority: 2,
      },
    ],
    lifecycle: {
      status: 'validated',
      sourceRef: 'packages/skills/literature-enrich/capability.manifest.json',
    },
  };
}

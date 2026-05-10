import assert from 'node:assert/strict';

import { loadCoreCapabilityManifestRegistry } from '../../src/runtime/capability-manifest-registry.js';
import { projectCapabilityManifestsToHarnessCandidates } from '../../src/runtime/capability-harness-candidates.js';
import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';

const graph = projectCapabilityManifestsToHarnessCandidates({
  manifests: [
    manifest('skill.literature-retrieval', 'skill', ['literature', 'retrieval']),
    manifest('tool.pubmed-search', 'skill', ['pubmed', 'search'], { harnessKind: 'tool', budget: { maxProviders: 1 } }),
    manifest('observe.vision', 'observe', ['vision']),
    manifest('action.computer-use', 'action', ['computer-use']),
    manifest('verifier.schema', 'verifier', ['schema']),
    manifest('view.report', 'view', ['report']),
  ],
  preferredCapabilityIds: ['skill.literature-retrieval'],
  availableProviders: [
    'provider.skill.literature-retrieval',
    'provider.tool.pubmed-search',
    'provider.observe.vision',
    'provider.action.computer-use',
    'provider.verifier.schema',
    'provider.view.report',
  ],
});

assert.equal(graph.contract, 'sciforge.unified-capability-graph.v1');
assert.deepEqual(new Set(graph.candidates.map((candidate) => candidate.kind)), new Set(['skill', 'tool', 'observe', 'action', 'verifier', 'view']));
assert.equal(graph.candidates[0]?.id, 'skill.literature-retrieval');
assert.equal(graph.candidates.find((candidate) => candidate.id === 'tool.pubmed-search')?.budget?.maxProviders, 1);
assert.ok(graph.candidates.every((candidate) => candidate.manifestRef && candidate.reasons.length > 0));
assert.ok(graph.candidates.every((candidate) => Array.isArray(candidate.providerAvailability)));
assert.ok(graph.candidates.every((candidate) => Array.isArray(candidate.fallbackCandidateIds)));
assert.ok(graph.audit.every((entry) => entry.manifestRef.startsWith('capability:')));

const gatedGraph = projectCapabilityManifestsToHarnessCandidates({
  manifests: [
    manifest('composed.literature-review', 'composed', ['literature'], {
      fallbackCandidateIds: ['skill.literature-retrieval', 'verifier.schema'],
    }),
    manifest('action.external-submit', 'action', ['external-submit']),
  ],
  blockedCapabilityIds: ['action.external-submit'],
  availableProviders: [{ id: 'provider.composed.literature-review', available: false, reason: 'missing API key' }],
});

assert.equal(gatedGraph.candidates.length, 0);
assert.equal(gatedGraph.audit.find((entry) => entry.id === 'composed.literature-review')?.blocked, 'provider unavailable: missing API key');
assert.deepEqual(
  gatedGraph.audit.find((entry) => entry.id === 'composed.literature-review')?.fallbackCandidateIds,
  ['skill.literature-retrieval', 'verifier.schema'],
);
assert.equal(gatedGraph.audit.find((entry) => entry.id === 'action.external-submit')?.blocked, 'blocked by harness/caller');

const registryGraph = loadCoreCapabilityManifestRegistry().projectHarnessCandidates({
  preferredCapabilityIds: ['observe.vision'],
});
assert.ok(registryGraph.candidates.some((candidate) => candidate.id === 'observe.vision' && candidate.kind === 'observe'));

console.log('[ok] unified capability graph projects skill/tool/observe/action/verifier/view manifests into harness candidates');

function manifest(
  id: string,
  kind: CapabilityManifest['kind'],
  routingTags: string[],
  metadata: Record<string, unknown> = {},
): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id,
    version: '0.1.0',
    ownerPackage: 'test/package',
    kind,
    brief: `${id} test manifest`,
    routingTags,
    domains: ['test'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: kind === 'action' ? ['workspace-write'] : ['none'],
    safety: { risk: kind === 'action' ? 'medium' : 'low', dataScopes: ['workspace'] },
    examples: [{ title: `${id} example` }],
    validators: [{ id: `${id}.schema`, kind: 'schema', expectedRefs: [] }],
    repairHints: [{ failureCode: 'contract-invalid', summary: 'repair', recoverActions: ['retry'] }],
    providers: [{
      id: `provider.${id}`,
      label: `${id} provider`,
      kind: 'package',
      requiredConfig: [],
    }],
    lifecycle: { status: 'validated', sourceRef: `test/${id}` },
    metadata,
  };
}

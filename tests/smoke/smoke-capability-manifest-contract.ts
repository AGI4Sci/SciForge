import assert from 'node:assert/strict';

import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  compactCapabilityManifestBrief,
  validateCapabilityManifestShape,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';

const coreManifests: CapabilityManifest[] = [
  manifest('runtime.artifact-resolve', 'Resolve object references to workspace-backed facts.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  manifest('runtime.artifact-read', 'Read bounded artifact, file, run, and execution-unit refs.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  manifest('runtime.artifact-render', 'Render artifacts into markdown, text, JSON, or preview-safe refs.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  manifest('runtime.workspace-read', 'Read allowed workspace paths through the runtime path contract.', 'action', 'src/runtime/workspace-paths.ts', ['workspace-read']),
  manifest('runtime.workspace-write', 'Write managed workspace outputs with stable refs.', 'action', 'src/runtime/workspace-task-runner.ts', ['workspace-write']),
  manifest('runtime.command-run', 'Run bounded workspace commands and capture stdout/stderr/output refs.', 'action', 'src/runtime/workspace-task-runner.ts', ['workspace-write']),
  manifest('runtime.python-task', 'Execute generated Python tasks against inputPath/outputPath contracts.', 'action', 'src/runtime/workspace-task-runner.ts', ['workspace-write']),
  manifest('observe.vision', 'Observe screenshots or images and return bounded visual evidence refs.', 'observe', 'packages/observe/vision', ['workspace-read']),
  manifest('action.computer-use', 'Perform guarded desktop actions with trace evidence.', 'action', 'packages/actions/computer-use', ['desktop']),
  manifest('view.report', 'Render report artifacts from manifest-bound refs.', 'view', 'packages/presentation/components', ['none']),
  manifest('view.evidence-matrix', 'Render evidence matrices from manifest-bound refs.', 'view', 'packages/presentation/components', ['none']),
  manifest('verifier.schema', 'Validate payloads, artifacts, refs, and UI manifests before completion.', 'verifier', 'packages/verifiers/schema', ['none']),
];

const ids = coreManifests.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, 'capability manifest ids must be unique');
assert.ok(coreManifests.length >= 8, 'core seed set should cover at least eight platform/capability surfaces');
assert.deepEqual(coreManifests.flatMap(validateCapabilityManifestShape), []);

const brief = compactCapabilityManifestBrief(coreManifests[0]);
assert.equal(brief.contract, CAPABILITY_MANIFEST_CONTRACT_ID);
assert.equal(brief.id, 'runtime.artifact-resolve');
assert.deepEqual(brief.providerIds, ['runtime.artifact-resolve.provider']);
assert.deepEqual(brief.validatorIds, ['runtime.artifact-resolve.schema']);
assert.deepEqual(brief.repairFailureCodes, ['contract-invalid']);
assert.equal('inputSchema' in brief, false, 'compact brief must not include full input schema');
assert.equal('examples' in brief, false, 'compact brief must not include examples');

const invalid = {
  ...coreManifests[0],
  id: '',
  providers: [],
  sideEffects: ['none', 'workspace-read'],
} as CapabilityManifest;
assert.match(validateCapabilityManifestShape(invalid).join('\n'), /id must be non-empty/);
assert.match(validateCapabilityManifestShape(invalid).join('\n'), /providers must include at least one provider/);
assert.match(validateCapabilityManifestShape(invalid).join('\n'), /sideEffects none cannot be combined/);

console.log('[ok] CapabilityManifest contract defines required source-of-truth fields and compact broker briefs');

function manifest(
  id: string,
  brief: string,
  kind: CapabilityManifest['kind'],
  sourceRef: string,
  sideEffects: CapabilityManifest['sideEffects'],
): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id.split('.').slice(1).join(' '),
    version: '0.1.0',
    ownerPackage: sourceRef.startsWith('packages/') ? sourceRef.split('/').slice(0, 3).join('/') : 'src/runtime',
    kind,
    brief,
    routingTags: id.split(/[.-]/).filter(Boolean),
    domains: ['workspace'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects,
    safety: {
      risk: sideEffects.includes('desktop') || sideEffects.includes('workspace-write') ? 'medium' : 'low',
      dataScopes: sideEffects.includes('none') ? [] : ['workspace'],
    },
    examples: [{
      title: `${id} smoke`,
      inputRef: 'contract:example-input',
      outputRef: 'contract:example-output',
    }],
    validators: [{
      id: `${id}.schema`,
      kind: 'schema',
      contractRef: `${id}#schema`,
    }],
    repairHints: [{
      failureCode: 'contract-invalid',
      summary: 'Regenerate payload according to this capability manifest contract.',
      recoverActions: ['reload-manifest', 'validate-io-schema', 'preserve-related-refs'],
    }],
    providers: [{
      id: `${id}.provider`,
      label: `${id} provider`,
      kind: sourceRef.startsWith('packages/') ? 'package' : 'built-in',
      contractRef: sourceRef,
      requiredConfig: [],
    }],
    lifecycle: {
      status: 'draft',
      sourceRef,
    },
  };
}

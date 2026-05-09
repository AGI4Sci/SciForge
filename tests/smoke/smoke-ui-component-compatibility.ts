import assert from 'node:assert/strict';

import { uiComponentManifests, uiComponentCompatibilityAliases } from '../../packages/presentation/components/index.js';
import { uiComponentElements } from '../../packages/scenarios/core/src/componentElements.js';
import { composeRuntimeUiManifest } from '../../src/runtime/workspace-runtime-gateway.js';
import { acceptedArtifactTypesForComponent, artifactTypesForComponents, uiModuleRegistry } from '../../src/ui/src/uiModuleRegistry.js';

const expectedSkeletonComponents = [
  'scientific-plot-viewer',
  'record-table',
  'graph-viewer',
  'point-set-viewer',
  'matrix-viewer',
  'structure-viewer',
  'sequence-viewer',
  'alignment-viewer',
  'time-series-viewer',
  'model-eval-viewer',
  'schema-form-editor',
  'comparison-viewer',
  'genome-track-viewer',
  'image-annotation-viewer',
  'spatial-omics-viewer',
  'plate-layout-viewer',
  'prediction-reviewer',
  'protocol-editor',
  'publication-figure-builder',
  'statistical-annotation-layer',
];

const manifestIds = new Set(uiComponentManifests.map((manifest) => manifest.componentId));
const uiRegistryIds = new Set(uiModuleRegistry.map((module) => module.componentId));
const scenarioComponentIds = new Set(uiComponentElements.map((component) => component.componentId));

for (const componentId of expectedSkeletonComponents) {
  assert.ok(manifestIds.has(componentId), `${componentId} missing from packages/presentation/components index`);
  assert.ok(uiRegistryIds.has(componentId), `${componentId} missing from UI module registry`);
  assert.ok(scenarioComponentIds.has(componentId), `${componentId} missing from scenario component registry`);
}

assert.deepEqual(
  uiComponentCompatibilityAliases.map((alias) => [alias.legacyComponentId, alias.routeComponentId, alias.activeComponentId]),
  [
    ['data-table', 'record-table', 'record-table'],
    ['network-graph', 'graph-viewer', 'graph-viewer'],
    ['volcano-plot', 'point-set-viewer', 'point-set-viewer'],
    ['umap-viewer', 'point-set-viewer', 'point-set-viewer'],
    ['heatmap-viewer', 'matrix-viewer', 'matrix-viewer'],
    ['molecule-viewer', 'structure-viewer', 'structure-viewer'],
    ['molecule-viewer-3d', 'structure-viewer', 'structure-viewer'],
  ],
);

assert.ok(acceptedArtifactTypesForComponent('record-table').includes('record-set'));
assert.ok(acceptedArtifactTypesForComponent('graph-viewer').includes('knowledge-graph'));
assert.ok(acceptedArtifactTypesForComponent('structure-viewer').includes('structure-summary'));
assert.ok(artifactTypesForComponents(['data-table']).includes('record-set'));

const aliasRuntimeManifest = composeRuntimeUiManifest(
  [],
  [
    { id: 'records', type: 'record-set' },
    { id: 'graph', type: 'knowledge-graph' },
    { id: 'structure', type: 'structure-summary' },
  ],
  {
    skillDomain: 'knowledge',
    prompt: 'Use the new route ids selected in UI state.',
    selectedComponentIds: ['record-table', 'graph-viewer', 'structure-viewer', 'point-set-viewer', 'matrix-viewer'],
  },
);

assert.deepEqual(
  aliasRuntimeManifest.map((slot) => slot.componentId),
  ['record-table', 'graph-viewer', 'structure-viewer', 'point-set-viewer', 'matrix-viewer', 'execution-unit-table'],
);

const newComponentPromptManifest = composeRuntimeUiManifest(
  [],
  [{ id: 'genome-track-demo', type: 'genome-track' }],
  {
    skillDomain: 'omics',
    prompt: 'Show genome track, image annotation, spatial omics and statistical annotation views.',
  },
);

const promptedComponentIds = newComponentPromptManifest.map((slot) => slot.componentId);
assert.ok(promptedComponentIds.includes('genome-track-viewer'));
assert.ok(promptedComponentIds.includes('image-annotation-viewer'));
assert.ok(promptedComponentIds.includes('spatial-omics-viewer'));
assert.ok(promptedComponentIds.includes('statistical-annotation-layer'));

console.log('[ok] T080 UI component compatibility aliases keep legacy ids valid and register new skeleton manifests');

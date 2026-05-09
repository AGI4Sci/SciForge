import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  composeRuntimeUiManifestSlots,
  interactiveViewCompatibilityAliases,
  interactiveViewManifests,
  uiComponentCompatibilityAliases,
  uiComponentManifests,
} from './index';

test('interactive views alias preserves ui-components registry compatibility', () => {
  assert.equal(interactiveViewManifests, uiComponentManifests);
  assert.equal(interactiveViewCompatibilityAliases, uiComponentCompatibilityAliases);
  assert.ok(interactiveViewManifests.some((manifest) => manifest.componentId === 'record-table'));
  assert.ok(uiComponentCompatibilityAliases.some((alias) => alias.legacyComponentId === 'data-table'));
});

test('runtime ui manifest policy composes package-owned view semantics', () => {
  const artifacts = [{ id: 'knowledge-graph', type: 'knowledge-graph' }];
  const manifest = composeRuntimeUiManifestSlots(
    [{ componentId: 'graph-viewer', artifactRef: 'knowledge-graph', priority: 1 }],
    artifacts,
    {
      skillDomain: 'knowledge',
      prompt: 'BRAF V600E target prioritization，只展示 data table、evidence matrix 和 execution unit，不需要网络图。',
    },
  );

  assert.deepEqual(
    manifest.map((slot) => slot.componentId),
    ['record-table', 'evidence-matrix', 'execution-unit-table'],
  );
  assert.equal(manifest[0].artifactRef, 'knowledge-graph');
});

test('runtime ui manifest policy infers package view encoding and layout', () => {
  const manifest = composeRuntimeUiManifestSlots(
    [],
    [{ id: 'omics-differential-expression', type: 'omics-differential-expression' }],
    {
      skillDomain: 'omics',
      prompt: '展示 UMAP，按 cellCycle 着色，按 batch 分组，并排对比。',
    },
  );

  assert.equal(manifest[0].componentId, 'point-set-viewer');
  assert.equal(manifest[0].artifactRef, 'omics-differential-expression');
  assert.equal((manifest[0].encoding as Record<string, unknown>).colorBy, 'cellCycle');
  assert.equal((manifest[0].encoding as Record<string, unknown>).splitBy, 'batch');
  assert.equal((manifest[0].layout as Record<string, unknown>).mode, 'side-by-side');
});

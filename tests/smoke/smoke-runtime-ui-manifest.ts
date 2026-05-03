import assert from 'node:assert/strict';

import { composeRuntimeUiManifest } from '../../src/runtime/workspace-runtime-gateway.js';

const artifacts = [{
  id: 'knowledge-graph',
  type: 'knowledge-graph',
  data: {
    nodes: [{ id: 'BRAF', label: 'BRAF', type: 'gene' }],
    edges: [],
    rows: [{ entity: 'BRAF', source: 'ChEMBL' }],
  },
}];

const explicitPromptManifest = composeRuntimeUiManifest(
  [{ componentId: 'graph-viewer', artifactRef: 'knowledge-graph', priority: 1 }],
  artifacts,
  {
    skillDomain: 'knowledge',
    prompt: 'BRAF V600E target prioritization，只展示 data table、evidence matrix 和 execution unit，不需要网络图。',
  },
);

assert.deepEqual(
  explicitPromptManifest.map((slot) => slot.componentId),
  ['record-table', 'evidence-matrix', 'execution-unit-table'],
);
assert.equal(explicitPromptManifest[0].artifactRef, 'knowledge-graph');

const overrideManifest = composeRuntimeUiManifest(
  [{ componentId: 'graph-viewer', artifactRef: 'knowledge-graph', priority: 1 }],
  artifacts,
  {
    skillDomain: 'knowledge',
    prompt: '生成药物靶点优先级视图。',
    uiState: {
      scenarioOverride: {
        defaultComponents: ['record-table', 'graph-viewer', 'execution-unit-table'],
      },
    },
  },
);

assert.deepEqual(
  overrideManifest.map((slot) => slot.componentId),
  ['record-table', 'graph-viewer', 'execution-unit-table'],
);

const viewCompositionManifest = composeRuntimeUiManifest(
  [],
  [{ id: 'omics-differential-expression', type: 'omics-differential-expression' }],
  {
    skillDomain: 'omics',
    prompt: '展示 UMAP，按 cellCycle 着色，按 batch 分组，并排对比。',
  },
);

assert.equal(viewCompositionManifest[0].componentId, 'point-set-viewer');
assert.equal(viewCompositionManifest[0].artifactRef, 'omics-differential-expression');
const encoding = viewCompositionManifest[0].encoding as Record<string, unknown>;
const layout = viewCompositionManifest[0].layout as Record<string, unknown>;
assert.equal(encoding.colorBy, 'cellCycle');
assert.equal(encoding.splitBy, 'batch');
assert.equal(layout.mode, 'side-by-side');

console.log('[ok] runtime UIManifest composition honors task-requested components, scenario overrides, and view composition hints');

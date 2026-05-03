import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/graph-viewer',
  moduleId: 'graph-viewer',
  version: '0.1.0',
  title: 'Graph viewer',
  description: 'Generic graph renderer for knowledge graph, PPI, pathway, causal graph, and workflow DAG presets.',
  componentId: 'graph-viewer',
  lifecycle: 'validated',
  outputArtifactTypes: ['graph', 'knowledge-graph'],
  acceptsArtifactTypes: ['graph', 'knowledge-graph', 'network-graph', 'pathway-graph', 'ppi-graph', 'workflow-dag'],
  requiredFields: ['nodes', 'edges'],
  viewParams: ['colorBy', 'filter', 'highlightSelection', 'preset'],
  interactionEvents: ['select-node', 'select-edge'],
  roleDefaults: ['experimental-biologist', 'pi'],
  fallbackModuleIds: ['record-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 25,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: { dedupeScope: 'entity', identityFields: ['graphId', 'graph_id', 'networkId', 'datasetId', 'dataRef'] },
  docs: {
    readmePath: 'packages/ui-components/graph-viewer/README.md',
    agentSummary: 'Use for graph artifacts with nodes and edges. Historical network-graph aliases route here.',
  },
  workbenchDemo: {
    artifactType: 'graph',
    artifactData: {
      nodes: [{ id: 'BRAF', label: 'BRAF', type: 'gene' }, { id: 'vemurafenib', label: 'Vemurafenib', type: 'drug' }],
      edges: [{ source: 'vemurafenib', target: 'BRAF', relation: 'targets', confidence: 0.92 }],
    },
  },
};

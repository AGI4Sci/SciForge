import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/network-graph',
  moduleId: 'knowledge-network-graph',
  version: '1.0.0',
  title: 'Knowledge network graph',
  description: 'Network renderer for knowledge-graph nodes and edges.',
  componentId: 'network-graph',
  lifecycle: 'published',
  outputArtifactTypes: ['knowledge-graph'],
  acceptsArtifactTypes: ['knowledge-graph'],
  requiredFields: ['nodes', 'edges'],
  viewParams: ['colorBy', 'filter', 'highlightSelection'],
  interactionEvents: ['select-node', 'select-edge'],
  roleDefaults: ['experimental-biologist', 'pi'],
  fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 25,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  docs: {
    readmePath: 'packages/ui-components/network-graph/README.md',
    agentSummary: 'Use for knowledge-graph artifacts. Requires nodes and edges.',
  },
  workbenchDemo: {
    artifactType: 'knowledge-graph',
    artifactData: {
      nodes: [
        { id: 'g1', label: 'Gene A', type: 'gene' },
        { id: 'g2', label: 'Gene B', type: 'gene' },
        { id: 'd1', label: 'Drug X', type: 'drug' },
      ],
      edges: [
        { source: 'g1', target: 'g2', relation: 'ppi', evidenceLevel: 'database', confidence: 0.81 },
        { source: 'd1', target: 'g1', relation: 'targets', evidenceLevel: 'review', confidence: 0.62 },
      ],
    },
  },
};

import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/network-graph',
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
};

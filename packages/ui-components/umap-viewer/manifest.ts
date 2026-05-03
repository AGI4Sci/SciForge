import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/umap-viewer',
  moduleId: 'omics-umap-viewer',
  version: '1.0.0',
  title: 'UMAP viewer',
  description: 'Embedding coordinate renderer for single-cell or omics artifacts.',
  componentId: 'umap-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['omics-differential-expression'],
  acceptsArtifactTypes: ['omics-differential-expression'],
  requiredFields: ['umap'],
  viewParams: ['colorBy', 'splitBy', 'highlightSelection'],
  interactionEvents: ['select-cluster'],
  roleDefaults: ['bioinformatician', 'experimental-biologist'],
  fallbackModuleIds: ['generic-data-table'],
  defaultSection: 'primary',
  priority: 28,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  docs: {
    readmePath: 'packages/ui-components/umap-viewer/README.md',
    agentSummary: 'Use for single-cell/omics embedding artifacts with umap coordinates. Emits select-cluster.',
  },
  workbenchDemo: {
    artifactType: 'omics-differential-expression',
    artifactData: {
      umap: [
        { x: -2.1, y: 0.4, cluster: 'C1', label: 'cell-a' },
        { x: -1.2, y: 1.1, cluster: 'C1', label: 'cell-b' },
        { x: 1.8, y: -0.6, cluster: 'C2', label: 'cell-c' },
        { x: 2.2, y: 0.9, cluster: 'C2', label: 'cell-d' },
      ],
    },
  },
};

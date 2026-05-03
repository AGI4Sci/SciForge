import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/umap-viewer',
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
};

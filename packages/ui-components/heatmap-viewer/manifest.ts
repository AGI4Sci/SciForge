import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/heatmap-viewer',
  moduleId: 'omics-heatmap-viewer',
  version: '1.0.0',
  title: 'Heatmap viewer',
  description: 'Matrix heatmap renderer for omics artifacts.',
  componentId: 'heatmap-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['omics-differential-expression'],
  acceptsArtifactTypes: ['omics-differential-expression'],
  requiredFields: ['heatmap'],
  viewParams: ['colorBy', 'splitBy', 'facetBy'],
  interactionEvents: ['select-gene-set'],
  roleDefaults: ['bioinformatician'],
  fallbackModuleIds: ['generic-data-table'],
  defaultSection: 'supporting',
  priority: 27,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  docs: {
    readmePath: 'packages/ui-components/heatmap-viewer/README.md',
    agentSummary: 'Use for omics differential-expression artifacts with heatmap matrix payloads.',
  },
};

import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/point-set-viewer',
  moduleId: 'point-set-viewer',
  version: '0.1.0',
  title: 'Point set viewer',
  description: 'Generic point-set renderer for volcano, UMAP, PCA, t-SNE, and embedding scatter presets.',
  componentId: 'point-set-viewer',
  lifecycle: 'validated',
  outputArtifactTypes: ['point-set', 'plot-spec'],
  acceptsArtifactTypes: ['point-set', 'plot-spec', 'omics-differential-expression', 'volcano-plot', 'umap-viewer', 'embedding-scatter'],
  viewParams: ['preset', 'x', 'y', 'label', 'colorBy', 'highlightSelection'],
  interactionEvents: ['select-point', 'select-region', 'hover-point'],
  roleDefaults: ['bioinformatician', 'experimental-biologist'],
  fallbackModuleIds: ['scientific-plot-viewer', 'record-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 23,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: { dedupeScope: 'entity', identityFields: ['pointSetId', 'datasetId', 'plotId', 'dataRef'] },
  docs: { readmePath: 'packages/presentation/components/point-set-viewer/README.md', agentSummary: 'Use for point-set presets. Historical volcano-plot and umap-viewer aliases route here.' },
  workbenchDemo: { artifactType: 'point-set', artifactData: { preset: 'volcano', points: [{ label: 'IFIT1', x: 2.1, y: 8.2, significant: true }, { label: 'IL7R', x: -1.2, y: 3.4 }] } },
};

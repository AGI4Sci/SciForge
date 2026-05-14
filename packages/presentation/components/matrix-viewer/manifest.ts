import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/matrix-viewer',
  moduleId: 'matrix-viewer',
  version: '0.1.0',
  title: 'Matrix viewer',
  description: 'Generic matrix heatmap renderer for matrix, expression, similarity, attention, and confusion-matrix payloads.',
  componentId: 'matrix-viewer',
  lifecycle: 'validated',
  outputArtifactTypes: ['matrix', 'plot-spec'],
  acceptsArtifactTypes: ['matrix', 'heatmap-viewer', 'omics-differential-expression', 'confusion-matrix', 'attention-map', 'similarity-matrix'],
  viewParams: ['colorBy', 'splitBy', 'facetBy', 'scale', 'selectedCell'],
  interactionEvents: ['select-cell', 'select-row', 'select-column'],
  roleDefaults: ['bioinformatician'],
  fallbackModuleIds: ['record-table', 'generic-artifact-inspector'],
  defaultSection: 'supporting',
  priority: 27,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: { dedupeScope: 'entity', identityFields: ['matrixId', 'matrix_id', 'datasetId', 'dataRef'] },
  docs: { readmePath: 'packages/presentation/components/matrix-viewer/README.md', agentSummary: 'Use for matrix-like payloads. Historical heatmap-viewer aliases route here.' },
  workbenchDemo: { artifactType: 'matrix', artifactData: { rows: ['IFIT1', 'ISG15'], columns: ['control', 'IFNB'], matrix: [[-0.8, 1.5], [-0.6, 1.2]] } },
};

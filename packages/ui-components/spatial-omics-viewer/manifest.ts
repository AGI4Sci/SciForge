import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/spatial-omics-viewer',
  moduleId: 'spatial-omics-viewer',
  version: '0.1.0',
  title: 'Spatial omics viewer',
  description: 'Skeleton spatial omics component for spot/cell coordinates with expression overlays.',
  componentId: 'spatial-omics-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['spatial-map', 'point-set', 'visual-annotation'],
  acceptsArtifactTypes: ['spatial-map', 'spatial-omics', 'visium-spots', 'cell-coordinates', 'tissue-expression-map'],
  requiredAnyFields: [['spots', 'cells', 'coordinates', 'imageRef', 'features', 'expression', 'dataRef']],
  viewParams: ['feature', 'clusterBy', 'colorBy', 'imageOpacity', 'spotRadius', 'selectedRegion'],
  interactionEvents: ['select-spot', 'select-cell', 'select-region', 'change-feature'],
  roleDefaults: ['bioinformatician', 'experimental-biologist'],
  fallbackModuleIds: ['scientific-plot-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 24,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['mapId', 'map_id', 'sampleId', 'sample_id', 'imageRef', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/spatial-omics-viewer/README.md',
    agentSummary: 'Use for tissue or spatial omics coordinate maps with expression overlays and optional image refs.',
  },
  workbenchDemo: {
    artifactType: 'spatial-map',
    artifactData: {
      primitive: 'spatial-map',
      id: 'visium-mini-demo',
      imageRef: 'workspace://images/tissue-section-demo.png',
      feature: 'MKI67',
      spots: [
        { id: 'AAAC', x: 120, y: 180, cluster: 'tumor', expression: { MKI67: 2.8 } },
        { id: 'AAAG', x: 180, y: 220, cluster: 'stroma', expression: { MKI67: 0.4 } },
      ],
    },
  },
};

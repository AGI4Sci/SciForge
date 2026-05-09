import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionSpatialOmicsViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'spatial-omics-viewer',
    props: { feature: 'MKI67', selectedRegion: { x: 100, y: 160, width: 100, height: 90 } },
  },
  artifact: {
    id: 'spatial-omics-visium-selection',
    type: 'spatial-map',
    producerScenario: 'visium-expression-preview',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'spatial-map',
      id: 'visium-breast-tumor-selection',
      sampleId: 'breast-tumor-section-01',
      imageRef: 'workspace://images/breast-tumor-hne.png',
      features: ['MKI67'],
      spots: [
        { id: 'AAAC', x: 120, y: 180, cluster: 'tumor', expression: { MKI67: 2.8 }, selected: true },
        { id: 'AAAG', x: 180, y: 220, cluster: 'stroma', expression: { MKI67: 0.4 }, selected: true },
      ],
      metadata: { selectedSpotIds: ['AAAC', 'AAAG'] },
    },
  },
};

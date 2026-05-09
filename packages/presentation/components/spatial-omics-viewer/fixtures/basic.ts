import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicSpatialOmicsViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'spatial-omics-viewer',
    props: { feature: 'MKI67', colorBy: 'expression', imageOpacity: 0.55 },
  },
  artifact: {
    id: 'spatial-omics-visium-mini',
    type: 'spatial-map',
    producerScenario: 'visium-expression-preview',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'spatial-map',
      id: 'visium-breast-tumor-mini',
      sampleId: 'breast-tumor-section-01',
      imageRef: 'workspace://images/breast-tumor-hne.png',
      features: ['MKI67', 'EPCAM', 'COL1A1'],
      spots: [
        { id: 'AAAC', x: 120, y: 180, cluster: 'tumor', expression: { MKI67: 2.8, EPCAM: 4.1, COL1A1: 0.2 } },
        { id: 'AAAG', x: 180, y: 220, cluster: 'stroma', expression: { MKI67: 0.4, EPCAM: 0.8, COL1A1: 3.5 } },
        { id: 'AACA', x: 240, y: 210, cluster: 'immune', expression: { MKI67: 1.1, EPCAM: 0.3, COL1A1: 0.9 } },
      ],
    },
  },
};

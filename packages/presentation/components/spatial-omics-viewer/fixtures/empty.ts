import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptySpatialOmicsViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'spatial-omics-viewer', props: { feature: 'MKI67' } },
  artifact: {
    id: 'spatial-omics-empty',
    type: 'spatial-map',
    producerScenario: 'visium-expression-preview',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'spatial-map',
      id: 'empty-spatial-map',
      sampleId: 'section-without-spots',
      imageRef: 'workspace://images/section-empty.png',
      features: [],
      spots: [],
      metadata: { reason: 'No spots passed tissue detection' },
    },
  },
};

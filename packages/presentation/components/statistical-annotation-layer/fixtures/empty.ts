import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyStatisticalAnnotationLayerFixture: UIComponentRendererProps = {
  slot: { componentId: 'statistical-annotation-layer', props: { showPValues: true } },
  artifact: {
    id: 'stat-annotation-empty',
    type: 'statistical-result',
    producerScenario: 'figure-stat-annotation',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'statistical-result',
      schemaVersion: '0.1.0',
      annotationSetId: 'empty-stat-annotations',
      target: { plotId: 'unknown-plot' },
      annotations: [],
      metadata: { reason: 'No statistical results are linked to the target plot' },
    },
  },
};

import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionStatisticalAnnotationLayerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'statistical-annotation-layer',
    props: { selectedAnnotationId: 'ifnb-vs-control', showPValues: true, showEffectSizes: true },
  },
  artifact: {
    id: 'stat-annotation-ifnb-selection',
    type: 'statistical-result',
    producerScenario: 'figure-stat-annotation',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'statistical-result',
      schemaVersion: '0.1.0',
      annotationSetId: 'ifnb-bars-stats-selection',
      target: { figureId: 'ifnb-response-figure', plotId: 'ifnb-response-bar', panelId: 'A' },
      annotations: [
        {
          id: 'ifnb-vs-control',
          kind: 'bracket',
          groups: ['control', 'IFNB'],
          pValue: 0.0032,
          adjustedPValue: 0.0064,
          effectSize: { name: 'log2FC', value: 1.68 },
          confidenceInterval: [1.1, 2.2],
          selected: true,
          label: 'q = 0.0064',
        },
      ],
      metadata: { selectedAnnotationId: 'ifnb-vs-control' },
    },
  },
};

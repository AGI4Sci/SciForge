import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicStatisticalAnnotationLayerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'statistical-annotation-layer',
    props: { targetPanelId: 'A', showPValues: true, showEffectSizes: true },
  },
  artifact: {
    id: 'stat-annotation-ifnb-bars',
    type: 'statistical-result',
    producerScenario: 'figure-stat-annotation',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'statistical-result',
      schemaVersion: '0.1.0',
      annotationSetId: 'ifnb-bars-stats',
      target: { figureId: 'ifnb-response-figure', plotId: 'ifnb-response-bar', panelId: 'A' },
      annotations: [
        {
          id: 'ifnb-vs-control',
          kind: 'bracket',
          groups: ['control', 'IFNB'],
          test: 'Welch t-test',
          n: { control: 3, IFNB: 3 },
          pValue: 0.0032,
          adjustedPValue: 0.0064,
          multipleTesting: 'Benjamini-Hochberg',
          effectSize: { name: 'log2FC', value: 1.68 },
          confidenceInterval: [1.1, 2.2],
          label: 'q = 0.0064',
        },
      ],
    },
  },
};

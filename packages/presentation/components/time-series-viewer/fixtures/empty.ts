import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyTimeSeriesViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'time-series-viewer', props: { timeUnit: 'hour' } },
  artifact: {
    id: 'time-series-empty',
    type: 'time-series',
    producerScenario: 'plate-reader-growth-curve',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'time-series',
      schemaVersion: '0.1.0',
      id: 'empty-time-series',
      title: 'No time-series points available',
      timeUnit: 'hour',
      series: [],
      metadata: { reason: 'No wells passed quality control' },
    },
  },
};

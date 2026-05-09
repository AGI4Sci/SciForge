import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionTimeSeriesViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'time-series-viewer',
    props: { timeUnit: 'hour', highlightWindow: [2, 4], selectedSeries: 'ciprofloxacin 0.25 ug/mL' },
  },
  artifact: {
    id: 'time-series-ecoli-selection',
    type: 'time-series',
    producerScenario: 'plate-reader-growth-curve',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'time-series',
      schemaVersion: '0.1.0',
      id: 'ecoli-ciprofloxacin-growth-selection',
      title: 'Selected inhibition window',
      timeUnit: 'hour',
      series: [
        {
          name: 'ciprofloxacin 0.25 ug/mL',
          unit: 'OD600',
          points: [
            { t: 0, value: 0.06 },
            { t: 2, value: 0.09, selected: true },
            { t: 4, value: 0.12, selected: true },
            { t: 6, value: 0.14 },
          ],
        },
      ],
      metadata: { selectedWindow: { start: 2, end: 4 }, selectedSeries: 'ciprofloxacin 0.25 ug/mL' },
    },
  },
};

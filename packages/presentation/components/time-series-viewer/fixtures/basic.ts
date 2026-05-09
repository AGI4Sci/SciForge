import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicTimeSeriesViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'time-series-viewer',
    props: { timeUnit: 'hour', showErrorBars: true, highlightWindow: [2, 4] },
  },
  artifact: {
    id: 'time-series-ecoli-od600',
    type: 'time-series',
    producerScenario: 'plate-reader-growth-curve',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'time-series',
      schemaVersion: '0.1.0',
      id: 'ecoli-ciprofloxacin-growth',
      title: 'E. coli OD600 response to ciprofloxacin',
      timeUnit: 'hour',
      series: [
        {
          name: 'control',
          unit: 'OD600',
          points: [
            { t: 0, value: 0.06, stderr: 0.004 },
            { t: 1, value: 0.1, stderr: 0.006 },
            { t: 2, value: 0.19, stderr: 0.01 },
            { t: 4, value: 0.61, stderr: 0.03 },
            { t: 6, value: 0.93, stderr: 0.04 },
          ],
        },
        {
          name: 'ciprofloxacin 0.25 ug/mL',
          unit: 'OD600',
          points: [
            { t: 0, value: 0.06, stderr: 0.003 },
            { t: 1, value: 0.07, stderr: 0.004 },
            { t: 2, value: 0.09, stderr: 0.005 },
            { t: 4, value: 0.12, stderr: 0.007 },
            { t: 6, value: 0.14, stderr: 0.009 },
          ],
        },
      ],
      metadata: { organism: 'E. coli K-12', selectedWindow: { start: 2, end: 4 } },
    },
  },
};

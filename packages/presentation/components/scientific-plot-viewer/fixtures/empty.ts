import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyPlotlySpecFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer' },
  artifact: {
    id: 'plot-empty',
    type: 'plot-spec',
    producerScenario: 'scientific-plot-smoke',
    schemaVersion: 'plotly-compatible.v1',
    data: {
      plotId: 'empty-spec',
      primitive: 'plot-spec',
      data: [],
      layout: { title: { text: 'Empty Plotly-compatible figure' } },
      config: { responsive: true },
    },
  },
};

export default emptyPlotlySpecFixture;

import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionPlotlySpecFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'scientific-plot-viewer',
    encoding: { colorBy: 'cluster', syncViewport: true },
  },
  artifact: {
    id: 'plot-selection-annotation-patch',
    type: 'point-set',
    producerScenario: 'scientific-plot-smoke',
    schemaVersion: 'plotly-compatible.v1',
    data: {
      plotSpec: {
        plotId: 'selected-point-set',
        primitive: 'plot-spec',
        data: [
          {
            type: 'scattergl',
            mode: 'markers',
            name: 'cells',
            x: [-2.1, -1.5, 0.2, 1.4, 2.0],
            y: [0.2, 0.8, -0.1, -0.7, 0.4],
            text: ['cell-a', 'cell-b', 'cell-c', 'cell-d', 'cell-e'],
            marker: { color: ['C1', 'C1', 'C2', 'C2', 'C3'], size: 7 },
          },
        ],
        layout: {
          title: { text: 'Selected embedding points with edit patch' },
          annotations: [{ text: 'Selected responder cluster', x: 1.4, y: -0.7, showarrow: true, arrowhead: 2 }],
        },
        selection: {
          mode: 'lasso',
          pointIndices: [1, 3],
          eventSource: 'plotly_selected',
          anchorFields: ['text'],
        },
        annotations: [
          {
            id: 'cluster-callout',
            kind: 'label',
            label: 'Selected responder cluster',
            coordinates: { x: 1.4, y: -0.7 },
            targetTrace: 'cells',
          },
        ],
        editPatch: {
          op: 'add',
          path: '/layout/annotations/-',
          value: { text: 'Selected responder cluster', x: 1.4, y: -0.7, showarrow: true },
          sourceEvent: 'select-region',
        },
      },
    },
  },
};

export default selectionPlotlySpecFixture;

import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const scenario = 'scientific-plot-smoke';
const schemaVersion = 'plotly-compatible.v1';

export const basicPlotlyScatterLineFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer' },
  artifact: {
    id: 'plot-basic-scatter-line',
    type: 'plot-spec',
    producerScenario: scenario,
    schemaVersion,
    data: {
      plotId: 'basic-scatter-line-confidence',
      primitive: 'plot-spec',
      data: [
        {
          type: 'scatter',
          mode: 'markers+lines',
          name: 'treated mean',
          x: [0, 1, 2, 3, 4],
          y: [1.1, 1.7, 2.4, 3.0, 3.6],
          marker: { color: '#2563eb', size: 8 },
          error_y: { type: 'data', array: [0.12, 0.16, 0.2, 0.24, 0.29], visible: true },
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: 'treated 95% CI',
          x: [0, 1, 2, 3, 4, 4, 3, 2, 1, 0],
          y: [0.9, 1.45, 2.12, 2.68, 3.22, 3.98, 3.32, 2.68, 1.95, 1.3],
          fill: 'toself',
          line: { color: 'rgba(37,99,235,0)' },
          fillcolor: 'rgba(37,99,235,0.18)',
          hoverinfo: 'skip',
        },
        {
          type: 'scatter',
          mode: 'lines',
          name: 'control',
          x: [0, 1, 2, 3, 4],
          y: [1.0, 1.2, 1.5, 1.7, 1.9],
          line: { color: '#64748b', dash: 'dash' },
        },
      ],
      layout: {
        title: { text: 'Dose response over time with confidence band' },
        xaxis: { title: { text: 'Time (h)' } },
        yaxis: { title: { text: 'Normalized signal' } },
        hovermode: 'x unified',
      },
      config: { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d'] },
      frames: [],
      exportProfile: {
        renderer: 'plotly',
        format: 'html',
        width: 760,
        height: 480,
        scale: 1,
      },
    },
  },
};

export const distributionAndErrorBarFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer', title: 'Distribution and uncertainty' },
  artifact: {
    id: 'plot-distribution-error-bar',
    type: 'plot-spec',
    producerScenario: scenario,
    schemaVersion,
    data: {
      plotId: 'box-violin-bar-error',
      primitive: 'plot-spec',
      data: [
        { type: 'box', name: 'control', y: [1.1, 1.3, 1.4, 1.8, 1.9], boxpoints: 'all' },
        { type: 'violin', name: 'treated', y: [2.0, 2.2, 2.7, 3.1, 3.3], box: { visible: true }, meanline: { visible: true } },
        {
          type: 'bar',
          name: 'assay mean',
          x: ['control', 'treated'],
          y: [1.5, 2.66],
          error_y: { type: 'data', array: [0.14, 0.21], visible: true },
          yaxis: 'y2',
        },
      ],
      layout: {
        title: { text: 'Distribution and assay mean uncertainty' },
        yaxis: { title: { text: 'Signal distribution' } },
        yaxis2: { title: { text: 'Mean signal' }, overlaying: 'y', side: 'right' },
      },
      config: { responsive: true, displaylogo: false },
    },
  },
};

export const heatmapCorrelationMatrixFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer', title: 'Correlation matrix' },
  artifact: {
    id: 'plot-heatmap-correlation',
    type: 'matrix',
    producerScenario: scenario,
    schemaVersion,
    data: {
      plotSpec: {
        plotId: 'correlation-heatmap',
        primitive: 'plot-spec',
        sourcePrimitive: 'matrix',
        data: [
          {
            type: 'heatmap',
            name: 'correlation',
            z: [
              [1, 0.82, -0.22, 0.11],
              [0.82, 1, -0.35, 0.18],
              [-0.22, -0.35, 1, 0.64],
              [0.11, 0.18, 0.64, 1],
            ],
            x: ['IFIT1', 'MX1', 'IL7R', 'CCR7'],
            y: ['IFIT1', 'MX1', 'IL7R', 'CCR7'],
            colorscale: 'RdBu',
            zmin: -1,
            zmax: 1,
          },
        ],
        layout: { title: { text: 'Gene correlation heatmap' } },
        config: { responsive: true, displaylogo: false },
      },
    },
  },
};

export const omicsPresetFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer', title: 'Volcano and UMAP presets' },
  artifact: {
    id: 'plot-omics-presets',
    type: 'plot-spec',
    producerScenario: scenario,
    schemaVersion,
    data: {
      plotId: 'volcano-umap-presets',
      primitive: 'plot-spec',
      preset: 'omics-volcano-plus-umap',
      data: [
        {
          type: 'scattergl',
          mode: 'markers',
          name: 'volcano',
          x: [3.2, 2.6, -1.7, 0.2],
          y: [12.1, 9.8, 4.5, 0.6],
          text: ['IFIT1', 'MX1', 'IL7R', 'GAPDH'],
          marker: { color: ['up', 'up', 'down', 'ns'], size: [10, 9, 8, 5] },
          xaxis: 'x',
          yaxis: 'y',
        },
        {
          type: 'scattergl',
          mode: 'markers',
          name: 'UMAP',
          x: [-5.1, -4.7, 2.2, 2.8, 0.4],
          y: [1.1, 1.8, -0.7, -1.1, 3.2],
          text: ['CD4_T', 'CD4_T', 'B_cell', 'B_cell', 'Monocyte'],
          marker: { color: ['#2563eb', '#2563eb', '#16a34a', '#16a34a', '#dc2626'], size: 7 },
          xaxis: 'x2',
          yaxis: 'y2',
        },
      ],
      layout: {
        title: { text: 'Volcano and UMAP preset preview' },
        grid: { rows: 1, columns: 2, pattern: 'independent' },
        xaxis: { title: { text: 'log2 fold change' } },
        yaxis: { title: { text: '-log10 adjusted p' } },
        xaxis2: { title: { text: 'UMAP 1' } },
        yaxis2: { title: { text: 'UMAP 2' } },
      },
      config: { responsive: true, displaylogo: false },
    },
  },
};

export const modelEvalFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer', title: 'Model evaluation' },
  artifact: {
    id: 'plot-model-eval',
    type: 'plot-spec',
    producerScenario: scenario,
    schemaVersion,
    data: {
      plotId: 'roc-pr-calibration',
      primitive: 'plot-spec',
      data: [
        { type: 'scatter', mode: 'lines', name: 'ROC AUC=0.91', x: [0, 0.04, 0.12, 1], y: [0, 0.62, 0.84, 1], xaxis: 'x', yaxis: 'y' },
        { type: 'scatter', mode: 'lines', name: 'PR AUC=0.87', x: [0.08, 0.32, 0.68, 1], y: [1, 0.92, 0.76, 0.41], xaxis: 'x2', yaxis: 'y2' },
        { type: 'scatter', mode: 'markers+lines', name: 'calibration', x: [0.1, 0.3, 0.5, 0.7, 0.9], y: [0.08, 0.29, 0.47, 0.72, 0.88], xaxis: 'x3', yaxis: 'y3' },
      ],
      layout: {
        title: { text: 'Classifier ROC, PR, and calibration' },
        grid: { rows: 1, columns: 3, pattern: 'independent' },
      },
      config: { responsive: true, displaylogo: false },
    },
  },
};

export const allScientificPlotRequirementFixtures = [
  basicPlotlyScatterLineFixture,
  distributionAndErrorBarFixture,
  heatmapCorrelationMatrixFixture,
  omicsPresetFixture,
  modelEvalFixture,
];

export default basicPlotlyScatterLineFixture;

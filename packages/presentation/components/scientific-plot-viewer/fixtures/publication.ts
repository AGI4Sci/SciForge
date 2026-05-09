import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const publicationExportProfileFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer', props: { renderer: 'plotly' } },
  artifact: {
    id: 'plot-publication-export',
    type: 'plot-spec',
    producerScenario: 'scientific-plot-smoke',
    schemaVersion: 'plotly-compatible.v1',
    data: {
      plotId: 'publication-export-profile',
      primitive: 'plot-spec',
      data: [
        { type: 'box', name: 'control', y: [1.1, 1.3, 1.4, 1.8] },
        { type: 'box', name: 'treated', y: [2.0, 2.2, 2.7, 3.1] },
      ],
      layout: {
        title: { text: 'Publication export profile demo' },
        font: { family: 'Arial', size: 9 },
        width: 720,
        height: 480,
      },
      config: { responsive: false, displayModeBar: false },
      exportProfile: {
        renderer: 'plotly',
        format: 'svg',
        width: 720,
        height: 480,
        scale: 2,
        journalProfile: 'two-column-life-sciences',
        vectorRequired: true,
        fontEmbedding: 'required',
        colorProfile: 'sRGB',
        qa: {
          minDpiForRaster: 600,
          colorBlindSafe: true,
          rasterization: 'none-detected',
          statisticsLinked: ['stat-ifnb-boxplot'],
        },
        derivedExports: [
          {
            renderer: 'matplotlib',
            purpose: 'advanced-publication-export',
            status: 'allowed-derived-fallback',
            sourcePlotSpecId: 'publication-export-profile',
            scriptRef: 'exports/publication-export-profile.matplotlib.py',
            outputRef: 'exports/publication-export-profile.pdf',
            rendererVersions: { matplotlib: '3.9.x', python: '3.11' },
          },
        ],
      },
      fallbackRenderers: [
        {
          renderer: 'matplotlib',
          purpose: 'advanced-publication-export',
          sourcePlotSpecId: 'publication-export-profile',
          derivedOnly: true,
        },
      ],
    },
  },
};

export const multiPanelPublicationFigureFixture: UIComponentRendererProps = {
  slot: { componentId: 'scientific-plot-viewer', title: 'Multi-panel publication figure' },
  artifact: {
    id: 'figure-publication-multipanel',
    type: 'figure-spec',
    producerScenario: 'scientific-plot-smoke',
    schemaVersion: 'figure-spec.v1',
    data: {
      primitive: 'figure-spec',
      id: 'figure-ifnb-response',
      title: 'Figure 1. Interferon response overview',
      caption: 'Multi-panel Plotly-compatible figure composed from shared plot-spec state.',
      layout: {
        columns: 2,
        rows: 2,
        panelLabels: ['A', 'B', 'C', 'D'],
        sharedLegend: true,
        typography: { family: 'Arial', sizePt: 8 },
      },
      panels: [
        { id: 'panel-a', label: 'A', primitive: 'plot-spec', plotSpecRef: 'plot-basic-scatter-line', title: 'Dose response' },
        { id: 'panel-b', label: 'B', primitive: 'plot-spec', plotSpecRef: 'plot-heatmap-correlation', title: 'Correlation matrix' },
        { id: 'panel-c', label: 'C', primitive: 'plot-spec', plotSpecRef: 'plot-omics-presets', title: 'Volcano preset' },
        { id: 'panel-d', label: 'D', primitive: 'plot-spec', plotSpecRef: 'plot-model-eval', title: 'Model evaluation' },
      ],
      exportProfile: {
        renderer: 'plotly',
        format: 'pdf',
        width: 174,
        height: 140,
        units: 'mm',
        scale: 2,
        targets: ['pdf', 'svg', 'png'],
        fallbackRenderer: {
          renderer: 'matplotlib',
          purpose: 'advanced-publication-export',
          derivedOnly: true,
        },
      },
    },
  },
};

export default publicationExportProfileFixture;

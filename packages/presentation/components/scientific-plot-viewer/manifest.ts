import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/scientific-plot-viewer',
  moduleId: 'scientific-plot-viewer',
  version: '0.1.0',
  title: 'Scientific plot viewer',
  description: 'Plotly-first scientific plotting viewer for interactive plot-spec artifacts.',
  componentId: 'scientific-plot-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['plot-spec', 'figure-spec', 'plot-export-bundle'],
  acceptsArtifactTypes: ['plot-spec', 'point-set', 'matrix', 'record-set', 'time-series'],
  viewParams: ['colorBy', 'splitBy', 'facetBy', 'highlightSelection', 'exportProfile', 'renderer', 'publicationProfile'],
  interactionEvents: ['select-point', 'select-region', 'hover-point', 'relayout', 'edit-annotation', 'export-plot'],
  roleDefaults: ['bioinformatician', 'experimental-biologist', 'pi'],
  fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 18,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['plotId', 'plot_id', 'figureId', 'figure_id', 'datasetId', 'dataset_id', 'dataRef', 'plotSpecRef', 'resultRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/scientific-plot-viewer/README.md',
    agentSummary: 'Use for Plotly-compatible plot-spec/figure-spec artifacts and primitive point-set, matrix, record-set, or time-series payloads. Plotly spec is the editing source of truth; Matplotlib is only a derived export fallback.',
  },
  workbenchDemo: {
    artifactType: 'plot-spec',
    artifactData: {
      plotId: 'demo-scatter-line',
      data: [
        { type: 'scatter', mode: 'markers+lines', name: 'treated', x: [0, 1, 2, 3], y: [1.1, 1.8, 2.6, 3.4] },
        { type: 'scatter', mode: 'lines', name: 'control', x: [0, 1, 2, 3], y: [0.9, 1.3, 1.7, 2.1] },
      ],
      layout: {
        title: { text: 'Demo response curve' },
        xaxis: { title: { text: 'Time (h)' } },
        yaxis: { title: { text: 'Signal' } },
      },
      config: { responsive: true, displaylogo: false },
    },
  },
};

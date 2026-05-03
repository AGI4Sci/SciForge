import { manifest as reportViewer } from './report-viewer/manifest';
import { manifest as moleculeViewer } from './molecule-viewer/manifest';
import { manifest as paperCardList } from './paper-card-list/manifest';
import { manifest as networkGraph } from './network-graph/manifest';
import { manifest as volcanoPlot } from './volcano-plot/manifest';
import { manifest as heatmapViewer } from './heatmap-viewer/manifest';
import { manifest as umapViewer } from './umap-viewer/manifest';
import { manifest as evidenceMatrix } from './evidence-matrix/manifest';
import { manifest as executionUnitTable } from './execution-unit-table/manifest';
import { manifest as notebookTimeline } from './notebook-timeline/manifest';
import { manifest as dataTable } from './data-table/manifest';
import { manifest as unknownArtifactInspector } from './unknown-artifact-inspector/manifest';
import type { UIComponentManifest } from './types';

export type { PresentationDedupeScope, UIComponentManifest } from './types';
export type { UIComponentRenderer, UIComponentRendererProps } from './types';
export { renderDataTable } from './data-table/render';
export { renderReportViewer, coerceReportPayload as coerceReportViewerPayload } from './report-viewer/render';

export const uiComponentManifests: UIComponentManifest[] = [
  reportViewer,
  moleculeViewer,
  paperCardList,
  networkGraph,
  volcanoPlot,
  heatmapViewer,
  umapViewer,
  evidenceMatrix,
  executionUnitTable,
  notebookTimeline,
  dataTable,
  unknownArtifactInspector,
];

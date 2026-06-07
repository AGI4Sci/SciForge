import { manifest as alignmentViewer } from './alignment-viewer/manifest.js';
import { manifest as browserWorkbench } from './browser-workbench/manifest.js';
import { manifest as computerUseControlPlane } from './computer-use-control-plane/manifest.js';
import { manifest as comparisonViewer } from './comparison-viewer/manifest.js';
import { manifest as evidenceMatrix } from './evidence-matrix/manifest.js';
import { manifest as executionUnitTable } from './execution-unit-table/manifest.js';
import { manifest as genomeTrackViewer } from './genome-track-viewer/manifest.js';
import { manifest as graphViewer } from './graph-viewer/manifest.js';
import { manifest as imageAnnotationViewer } from './image-annotation-viewer/manifest.js';
import { manifest as imageEvidenceViewer } from './image-evidence-viewer/manifest.js';
import { manifest as matrixViewer } from './matrix-viewer/manifest.js';
import { manifest as modelEvalViewer } from './model-eval-viewer/manifest.js';
import { manifest as notebookTimeline } from './notebook-timeline/manifest.js';
import { manifest as paperCardList } from './paper-card-list/manifest.js';
import { manifest as plateLayoutViewer } from './plate-layout-viewer/manifest.js';
import { manifest as pointSetViewer } from './point-set-viewer/manifest.js';
import { manifest as predictionReviewer } from './prediction-reviewer/manifest.js';
import { manifest as protocolEditor } from './protocol-editor/manifest.js';
import { manifest as publicationFigureBuilder } from './publication-figure-builder/manifest.js';
import { manifest as recordTable } from './record-table/manifest.js';
import { manifest as reportViewer } from './report-viewer/manifest.js';
import { manifest as schemaFormEditor } from './schema-form-editor/manifest.js';
import { manifest as scientificPlotViewer } from './scientific-plot-viewer/manifest.js';
import { manifest as sequenceViewer } from './sequence-viewer/manifest.js';
import { manifest as spatialOmicsViewer } from './spatial-omics-viewer/manifest.js';
import { manifest as statisticalAnnotationLayer } from './statistical-annotation-layer/manifest.js';
import { manifest as structureViewer } from './structure-viewer/manifest.js';
import { manifest as terminalSessionViewer } from './terminal-session-viewer/manifest.js';
import { manifest as timeSeriesViewer } from './time-series-viewer/manifest.js';
import { manifest as unknownArtifactInspector } from './unknown-artifact-inspector/manifest.js';
import { manifest as workspaceFileViewer } from './workspace-file-viewer/manifest.js';
import type { UIComponentManifest } from './types.js';

export const uiComponentManifests: UIComponentManifest[] = [
  reportViewer,
  browserWorkbench,
  computerUseControlPlane,
  paperCardList,
  evidenceMatrix,
  executionUnitTable,
  notebookTimeline,
  recordTable,
  graphViewer,
  pointSetViewer,
  matrixViewer,
  structureViewer,
  terminalSessionViewer,
  scientificPlotViewer,
  sequenceViewer,
  alignmentViewer,
  timeSeriesViewer,
  modelEvalViewer,
  schemaFormEditor,
  comparisonViewer,
  genomeTrackViewer,
  imageAnnotationViewer,
  imageEvidenceViewer,
  spatialOmicsViewer,
  plateLayoutViewer,
  predictionReviewer,
  protocolEditor,
  publicationFigureBuilder,
  statisticalAnnotationLayer,
  workspaceFileViewer,
  unknownArtifactInspector,
];

export const interactiveViewManifests = uiComponentManifests;

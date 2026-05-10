import { manifest as alignmentViewer } from './alignment-viewer/manifest';
import { manifest as comparisonViewer } from './comparison-viewer/manifest';
import { manifest as evidenceMatrix } from './evidence-matrix/manifest';
import { manifest as executionUnitTable } from './execution-unit-table/manifest';
import { manifest as genomeTrackViewer } from './genome-track-viewer/manifest';
import { manifest as graphViewer } from './graph-viewer/manifest';
import { manifest as imageAnnotationViewer } from './image-annotation-viewer/manifest';
import { manifest as matrixViewer } from './matrix-viewer/manifest';
import { manifest as modelEvalViewer } from './model-eval-viewer/manifest';
import { manifest as notebookTimeline } from './notebook-timeline/manifest';
import { manifest as paperCardList } from './paper-card-list/manifest';
import { manifest as plateLayoutViewer } from './plate-layout-viewer/manifest';
import { manifest as pointSetViewer } from './point-set-viewer/manifest';
import { manifest as predictionReviewer } from './prediction-reviewer/manifest';
import { manifest as protocolEditor } from './protocol-editor/manifest';
import { manifest as publicationFigureBuilder } from './publication-figure-builder/manifest';
import { manifest as recordTable } from './record-table/manifest';
import { manifest as reportViewer } from './report-viewer/manifest';
import { manifest as schemaFormEditor } from './schema-form-editor/manifest';
import { manifest as scientificPlotViewer } from './scientific-plot-viewer/manifest';
import { manifest as sequenceViewer } from './sequence-viewer/manifest';
import { manifest as spatialOmicsViewer } from './spatial-omics-viewer/manifest';
import { manifest as statisticalAnnotationLayer } from './statistical-annotation-layer/manifest';
import { manifest as structureViewer } from './structure-viewer/manifest';
import { manifest as timeSeriesViewer } from './time-series-viewer/manifest';
import { manifest as unknownArtifactInspector } from './unknown-artifact-inspector/manifest';
import type { UIComponentManifest } from './types';

export const uiComponentManifests: UIComponentManifest[] = [
  reportViewer,
  paperCardList,
  evidenceMatrix,
  executionUnitTable,
  notebookTimeline,
  recordTable,
  graphViewer,
  pointSetViewer,
  matrixViewer,
  structureViewer,
  scientificPlotViewer,
  sequenceViewer,
  alignmentViewer,
  timeSeriesViewer,
  modelEvalViewer,
  schemaFormEditor,
  comparisonViewer,
  genomeTrackViewer,
  imageAnnotationViewer,
  spatialOmicsViewer,
  plateLayoutViewer,
  predictionReviewer,
  protocolEditor,
  publicationFigureBuilder,
  statisticalAnnotationLayer,
  unknownArtifactInspector,
];

export const interactiveViewManifests = uiComponentManifests;

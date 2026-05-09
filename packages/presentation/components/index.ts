import { manifest as reportViewer } from './report-viewer/manifest';
import { manifest as paperCardList } from './paper-card-list/manifest';
import { manifest as evidenceMatrix } from './evidence-matrix/manifest';
import { manifest as executionUnitTable } from './execution-unit-table/manifest';
import { manifest as notebookTimeline } from './notebook-timeline/manifest';
import { manifest as recordTable } from './record-table/manifest';
import { manifest as graphViewer } from './graph-viewer/manifest';
import { manifest as pointSetViewer } from './point-set-viewer/manifest';
import { manifest as matrixViewer } from './matrix-viewer/manifest';
import { manifest as structureViewer } from './structure-viewer/manifest';
import { manifest as unknownArtifactInspector } from './unknown-artifact-inspector/manifest';
import { manifest as scientificPlotViewer } from './scientific-plot-viewer/manifest';
import { manifest as sequenceViewer } from './sequence-viewer/manifest';
import { manifest as alignmentViewer } from './alignment-viewer/manifest';
import { manifest as timeSeriesViewer } from './time-series-viewer/manifest';
import { manifest as modelEvalViewer } from './model-eval-viewer/manifest';
import { manifest as schemaFormEditor } from './schema-form-editor/manifest';
import { manifest as comparisonViewer } from './comparison-viewer/manifest';
import { manifest as genomeTrackViewer } from './genome-track-viewer/manifest';
import { manifest as imageAnnotationViewer } from './image-annotation-viewer/manifest';
import { manifest as spatialOmicsViewer } from './spatial-omics-viewer/manifest';
import { manifest as plateLayoutViewer } from './plate-layout-viewer/manifest';
import { manifest as predictionReviewer } from './prediction-reviewer/manifest';
import { manifest as protocolEditor } from './protocol-editor/manifest';
import { manifest as publicationFigureBuilder } from './publication-figure-builder/manifest';
import { manifest as statisticalAnnotationLayer } from './statistical-annotation-layer/manifest';
import type { UIComponentManifest } from './types';

export type { PresentationDedupeScope, UIComponentManifest, UIComponentWorkbenchDemo } from './types';
export type { UIComponentRenderer, UIComponentRendererProps } from './types';
export {
  defaultWorkbenchRecommendationInput,
  defaultWorkbenchDemoContext,
  normalizeWorkbenchFixtureArtifact,
  shouldBuildWorkbenchFigureQA,
  workbenchComponentFixtures,
  workbenchComponentRecommendationBoost,
  workbenchDemoVariants,
  workbenchExecutionSafetyLabel,
  workbenchListEmptyLabels,
  workbenchModuleDisplayLabels,
  workbenchSafetySummary,
  type WorkbenchDemoVariant,
} from './workbench-policy';
export { renderPackageWorkbenchPreview } from './workbench-renderers';
export { renderReportViewer, coerceReportPayload as coerceReportViewerPayload } from './report-viewer/render';
export { renderPaperCardList, paperCardListPresentationPolicy, type PaperCardPresentation } from './paper-card-list/render';
export { renderRecordTable } from './record-table/render';
export { renderGraphViewer } from './graph-viewer/render';
export { renderPointSetViewer } from './point-set-viewer/render';
export { renderMatrixViewer } from './matrix-viewer/render';
export { renderStructureViewer } from './structure-viewer/render';

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

export const uiComponentCompatibilityAliases = [
  {
    legacyComponentId: 'data-table',
    routeComponentId: 'record-table',
    activeComponentId: 'record-table',
    status: 'deprecated-alias',
    note: 'data-table is accepted only as a historical alias; new slots should use record-table.',
  },
  {
    legacyComponentId: 'network-graph',
    routeComponentId: 'graph-viewer',
    activeComponentId: 'graph-viewer',
    status: 'deprecated-alias',
    note: 'network-graph is accepted only as a historical alias; new slots should use graph-viewer.',
  },
  {
    legacyComponentId: 'volcano-plot',
    routeComponentId: 'point-set-viewer',
    activeComponentId: 'point-set-viewer',
    status: 'deprecated-alias',
    note: 'volcano-plot is accepted only as a historical point-set preset alias.',
  },
  {
    legacyComponentId: 'umap-viewer',
    routeComponentId: 'point-set-viewer',
    activeComponentId: 'point-set-viewer',
    status: 'deprecated-alias',
    note: 'umap-viewer is accepted only as a historical point-set preset alias.',
  },
  {
    legacyComponentId: 'heatmap-viewer',
    routeComponentId: 'matrix-viewer',
    activeComponentId: 'matrix-viewer',
    status: 'deprecated-alias',
    note: 'heatmap-viewer is accepted only as a historical alias; new slots should use matrix-viewer.',
  },
  {
    legacyComponentId: 'molecule-viewer',
    routeComponentId: 'structure-viewer',
    activeComponentId: 'structure-viewer',
    status: 'deprecated-alias',
    note: 'molecule-viewer is accepted only as a historical alias; new slots should use structure-viewer.',
  },
  {
    legacyComponentId: 'molecule-viewer-3d',
    routeComponentId: 'structure-viewer',
    activeComponentId: 'structure-viewer',
    status: 'deprecated-alias',
    note: 'molecule-viewer-3d is accepted only as a historical alias; new slots should use structure-viewer.',
  },
] as const;

export const interactiveViewCompatibilityAliases = uiComponentCompatibilityAliases;

export const uiComponentAliasTargetMap: Record<string, string> = Object.fromEntries(
  uiComponentCompatibilityAliases.map((alias) => [alias.legacyComponentId, alias.activeComponentId]),
);

export type UIComponentCompatibilityAlias = typeof uiComponentCompatibilityAliases[number];

export function normalizeUIComponentId(componentId: string) {
  return uiComponentAliasTargetMap[componentId] ?? componentId;
}

function compatibilityAliasManifest(
  alias: UIComponentCompatibilityAlias,
  manifests: UIComponentManifest[],
): UIComponentManifest {
  const target = manifests.find((module) => module.componentId === alias.activeComponentId)
    ?? manifests.find((module) => module.componentId === alias.routeComponentId);
  return {
    ...(target ?? manifests.find((module) => module.componentId === 'unknown-artifact-inspector') ?? manifests[0]),
    packageName: target?.packageName ?? `@sciforge-ui/${alias.legacyComponentId}`,
    moduleId: alias.legacyComponentId,
    title: target ? `${target.title} (${alias.legacyComponentId})` : alias.legacyComponentId,
    description: target ? `${alias.note} Routed to ${alias.routeComponentId}.` : alias.note,
    componentId: alias.legacyComponentId,
    acceptsArtifactTypes: target?.acceptsArtifactTypes ?? [],
    outputArtifactTypes: target?.outputArtifactTypes ?? [],
    fallbackModuleIds: Array.from(new Set([
      ...(target?.fallbackModuleIds ?? []),
      ...(alias.legacyComponentId === 'volcano-plot' ? ['generic-data-table'] : []),
    ])),
    docs: {
      readmePath: target?.docs.readmePath ?? 'packages/presentation/components/README.md',
      agentSummary: `${alias.legacyComponentId} is a compatibility alias for ${alias.routeComponentId}.`,
    },
  };
}

export function buildUIComponentRuntimeRegistry(
  manifests: UIComponentManifest[] = uiComponentManifests,
  aliases: readonly UIComponentCompatibilityAlias[] = uiComponentCompatibilityAliases,
): UIComponentManifest[] {
  return Array.from(
    new Map(
      [
        ...manifests,
        ...aliases.map((alias) => compatibilityAliasManifest(alias, manifests)),
      ].map((module) => [`${module.moduleId}@${module.version}:${module.componentId}`, module]),
    ).values(),
  );
}

export const uiComponentRuntimeRegistry: UIComponentManifest[] = buildUIComponentRuntimeRegistry();

export function buildUIComponentArtifactTypeIndex(manifests: UIComponentManifest[] = uiComponentManifests): Record<string, string[]> {
  const artifactTypes = manifests.reduce<Record<string, string[]>>((acc, module) => {
    const current = acc[module.componentId] ?? [];
    acc[module.componentId] = Array.from(new Set([...current, ...module.acceptsArtifactTypes]));
    return acc;
  }, {});
  for (const alias of uiComponentCompatibilityAliases) {
    artifactTypes[alias.legacyComponentId] = artifactTypes[alias.activeComponentId] ?? artifactTypes[alias.routeComponentId] ?? [];
  }
  return artifactTypes;
}

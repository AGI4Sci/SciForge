import type { UIComponentManifest, UIComponentRendererProps, UIComponentRuntimeArtifact } from './types';
import { basicEvidenceMatrixFixture } from './evidence-matrix/fixtures/basic';
import { emptyEvidenceMatrixFixture } from './evidence-matrix/fixtures/empty';
import { selectionEvidenceMatrixFixture } from './evidence-matrix/fixtures/selection';
import { basicExecutionUnitTableFixture } from './execution-unit-table/fixtures/basic';
import { emptyExecutionUnitTableFixture } from './execution-unit-table/fixtures/empty';
import { selectionExecutionUnitTableFixture } from './execution-unit-table/fixtures/selection';
import { basicGraphViewerFixture } from './graph-viewer/fixtures/basic';
import { emptyGraphViewerFixture } from './graph-viewer/fixtures/empty';
import { selectionGraphViewerFixture } from './graph-viewer/fixtures/selection';
import { basicMatrixViewerFixture } from './matrix-viewer/fixtures/basic';
import { emptyMatrixViewerFixture } from './matrix-viewer/fixtures/empty';
import { selectionMatrixViewerFixture } from './matrix-viewer/fixtures/selection';
import { basicNotebookTimelineFixture } from './notebook-timeline/fixtures/basic';
import { emptyNotebookTimelineFixture } from './notebook-timeline/fixtures/empty';
import { selectionNotebookTimelineFixture } from './notebook-timeline/fixtures/selection';
import { basicPaperCardListFixture } from './paper-card-list/fixtures/basic';
import { emptyPaperCardListFixture } from './paper-card-list/fixtures/empty';
import { selectionPaperCardListFixture } from './paper-card-list/fixtures/selection';
import { basicPointSetViewerFixture } from './point-set-viewer/fixtures/basic';
import { emptyPointSetViewerFixture } from './point-set-viewer/fixtures/empty';
import { selectionPointSetViewerFixture } from './point-set-viewer/fixtures/selection';
import { basicRecordTableFixture } from './record-table/fixtures/basic';
import { emptyRecordTableFixture } from './record-table/fixtures/empty';
import { selectionRecordTableFixture } from './record-table/fixtures/selection';
import { basicReportViewerFixture } from './report-viewer/fixtures/basic';
import { emptyReportViewerFixture } from './report-viewer/fixtures/empty';
import { selectionReportViewerFixture } from './report-viewer/fixtures/selection';
import { basicPlotlyScatterLineFixture } from './scientific-plot-viewer/fixtures/basic';
import { basicStructureViewerFixture } from './structure-viewer/fixtures/basic';
import { emptyStructureViewerFixture } from './structure-viewer/fixtures/empty';
import { selectionStructureViewerFixture } from './structure-viewer/fixtures/selection';
import { basicUnknownArtifactInspectorFixture } from './unknown-artifact-inspector/fixtures/basic';
import { emptyUnknownArtifactInspectorFixture } from './unknown-artifact-inspector/fixtures/empty';
import { selectionUnknownArtifactInspectorFixture } from './unknown-artifact-inspector/fixtures/selection';

export type WorkbenchDemoVariant = 'basic' | 'empty' | 'selection';

export const workbenchDemoVariants: WorkbenchDemoVariant[] = ['basic', 'empty', 'selection'];

export const workbenchListEmptyLabels = {
  default: 'none',
  backendDecides: 'backend-decides',
  noInteractionEvents: 'no interaction events declared',
} as const;

export const defaultWorkbenchRecommendationInput = {
  artifactType: 'omics-differential-expression',
  artifactSchemaText: 'points logFC negLogP gene',
} as const;

export const defaultWorkbenchDemoContext = {
  scenarioId: 'literature-evidence-review',
  fallbackArtifactType: 'runtime-artifact',
} as const;

export const workbenchComponentFixtures: Record<string, Partial<Record<WorkbenchDemoVariant, UIComponentRendererProps>>> = {
  'data-table': {
    basic: basicRecordTableFixture,
    empty: emptyRecordTableFixture,
    selection: selectionRecordTableFixture,
  },
  'record-table': {
    basic: basicRecordTableFixture,
    empty: emptyRecordTableFixture,
    selection: selectionRecordTableFixture,
  },
  'evidence-matrix': {
    basic: basicEvidenceMatrixFixture,
    empty: emptyEvidenceMatrixFixture,
    selection: selectionEvidenceMatrixFixture,
  },
  'execution-unit-table': {
    basic: basicExecutionUnitTableFixture,
    empty: emptyExecutionUnitTableFixture,
    selection: selectionExecutionUnitTableFixture,
  },
  'heatmap-viewer': {
    basic: basicMatrixViewerFixture,
    empty: emptyMatrixViewerFixture,
    selection: selectionMatrixViewerFixture,
  },
  'matrix-viewer': {
    basic: basicMatrixViewerFixture,
    empty: emptyMatrixViewerFixture,
    selection: selectionMatrixViewerFixture,
  },
  'molecule-viewer': {
    basic: basicStructureViewerFixture,
    empty: emptyStructureViewerFixture,
    selection: selectionStructureViewerFixture,
  },
  'structure-viewer': {
    basic: basicStructureViewerFixture,
    empty: emptyStructureViewerFixture,
    selection: selectionStructureViewerFixture,
  },
  'network-graph': {
    basic: basicGraphViewerFixture,
    empty: emptyGraphViewerFixture,
    selection: selectionGraphViewerFixture,
  },
  'graph-viewer': {
    basic: basicGraphViewerFixture,
    empty: emptyGraphViewerFixture,
    selection: selectionGraphViewerFixture,
  },
  'notebook-timeline': {
    basic: basicNotebookTimelineFixture,
    empty: emptyNotebookTimelineFixture,
    selection: selectionNotebookTimelineFixture,
  },
  'paper-card-list': {
    basic: basicPaperCardListFixture,
    empty: emptyPaperCardListFixture,
    selection: selectionPaperCardListFixture,
  },
  'report-viewer': {
    basic: basicReportViewerFixture,
    empty: emptyReportViewerFixture,
    selection: selectionReportViewerFixture,
  },
  'scientific-plot-viewer': {
    basic: basicPlotlyScatterLineFixture,
  },
  'umap-viewer': {
    basic: basicPointSetViewerFixture,
    empty: emptyPointSetViewerFixture,
    selection: selectionPointSetViewerFixture,
  },
  'point-set-viewer': {
    basic: basicPointSetViewerFixture,
    empty: emptyPointSetViewerFixture,
    selection: selectionPointSetViewerFixture,
  },
  'unknown-artifact-inspector': {
    basic: basicUnknownArtifactInspectorFixture,
    empty: emptyUnknownArtifactInspectorFixture,
    selection: selectionUnknownArtifactInspectorFixture,
  },
  'volcano-plot': {
    basic: basicPointSetViewerFixture,
    empty: emptyPointSetViewerFixture,
    selection: selectionPointSetViewerFixture,
  },
};

const figureQaComponents = new Set(['scientific-plot-viewer', 'publication-figure-builder']);

const recommendationBoosts: Record<string, Array<{ fields?: string[]; artifactType?: string; score: number; reason: string }>> = {
  'volcano-plot': [
    { fields: ['logFC', 'negLogP', 'gene'], score: 3, reason: 'volcano fields matched' },
  ],
  'umap-viewer': [
    { fields: ['umap', 'x', 'y'], score: 3, reason: 'embedding fields matched' },
  ],
  'scientific-plot-viewer': [
    { artifactType: 'plot-spec', score: 6, reason: 'plot-spec primary renderer' },
  ],
};

export function normalizeWorkbenchFixtureArtifact(
  componentId: string,
  artifact: UIComponentRuntimeArtifact,
): UIComponentRuntimeArtifact {
  if (componentId === 'data-table') return { ...artifact, id: 'de-table-mini', type: 'data-table' };
  return artifact;
}

export function shouldBuildWorkbenchFigureQA(componentId: string): boolean {
  return figureQaComponents.has(componentId);
}

export function workbenchModuleDisplayLabels(
  modules: Pick<UIComponentManifest, 'moduleId' | 'componentId' | 'title'>[],
  moduleIds: string[] | undefined,
): string[] {
  if (!moduleIds?.length) return [];
  return moduleIds.map((moduleId) => {
    const match = modules.find((module) => module.moduleId === moduleId || module.componentId === moduleId);
    return match?.title ?? moduleId;
  });
}

export function workbenchComponentRecommendationBoost(input: {
  componentId: string;
  artifactType?: string;
  fields: string[];
}): { score: number; reasons: string[] } {
  const boosts = recommendationBoosts[input.componentId] ?? [];
  return boosts.reduce<{ score: number; reasons: string[] }>((acc, boost) => {
    const artifactMatches = boost.artifactType ? input.artifactType === boost.artifactType : true;
    const fieldMatches = boost.fields ? input.fields.some((field) => boost.fields?.includes(field)) : true;
    if (!artifactMatches || !fieldMatches) return acc;
    return { score: acc.score + boost.score, reasons: [...acc.reasons, boost.reason] };
  }, { score: 0, reasons: [] });
}

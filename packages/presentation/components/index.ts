import { uiComponentManifests } from './manifest-registry';
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

export { interactiveViewManifests, uiComponentManifests } from './manifest-registry';

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

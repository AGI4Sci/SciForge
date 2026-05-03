import { uiComponentManifests, type PresentationDedupeScope, type UIComponentManifest } from '../../../packages/ui-components';

export type { PresentationDedupeScope };
export type RuntimeUIModule = UIComponentManifest;

export const uiModuleRegistry: RuntimeUIModule[] = Array.from(
  new Map(
    uiComponentManifests
      .map((module) => [`${module.moduleId}@${module.version}:${module.componentId}`, module]),
  ).values(),
);

export const uiComponentAliasTargets: Record<string, string> = {
  'data-table': 'record-table',
  'network-graph': 'graph-viewer',
  'volcano-plot': 'point-set-viewer',
  'umap-viewer': 'point-set-viewer',
  'heatmap-viewer': 'matrix-viewer',
  'molecule-viewer': 'structure-viewer',
  'molecule-viewer-3d': 'structure-viewer',
};

const uiComponentAliasAcceptedArtifactTypes: Record<string, string[]> = {
  'data-table': ['record-set', 'table', 'dataframe', 'annotation-table', 'knowledge-graph'],
  'record-table': ['record-set', 'table', 'dataframe', 'annotation-table'],
  'network-graph': ['graph', 'knowledge-graph'],
  'graph-viewer': ['graph', 'knowledge-graph'],
  'volcano-plot': ['point-set', 'plot-spec', 'omics-differential-expression'],
  'umap-viewer': ['point-set', 'plot-spec', 'omics-differential-expression'],
  'point-set-viewer': ['point-set', 'plot-spec', 'omics-differential-expression'],
  'heatmap-viewer': ['matrix', 'omics-differential-expression'],
  'matrix-viewer': ['matrix', 'heatmap-viewer', 'omics-differential-expression'],
  'molecule-viewer': ['structure-3d', 'structure-summary', 'pdb-file', 'mmcif-file'],
  'structure-viewer': ['structure-3d', 'structure-summary', 'pdb-file', 'mmcif-file'],
};

export function normalizeUIComponentId(componentId: string) {
  return uiComponentAliasTargets[componentId] ?? componentId;
}

export const componentArtifactTypes: Record<string, string[]> = uiModuleRegistry.reduce<Record<string, string[]>>((acc, module) => {
  const current = acc[module.componentId] ?? [];
  acc[module.componentId] = Array.from(new Set([...current, ...module.acceptsArtifactTypes]));
  return acc;
}, {});

for (const [alias, target] of Object.entries(uiComponentAliasTargets)) {
  componentArtifactTypes[alias] = componentArtifactTypes[target] ?? [];
}

export function artifactTypesForComponents(componentIds: string[]) {
  const componentOutputTypes = uiModuleRegistry.reduce<Record<string, string[]>>((acc, module) => {
    const current = acc[module.componentId] ?? [];
    acc[module.componentId] = Array.from(new Set([...current, ...(module.outputArtifactTypes ?? [])]));
    return acc;
  }, {});
  return Array.from(new Set(componentIds.flatMap((componentId) => componentOutputTypes[normalizeUIComponentId(componentId)] ?? [])))
    .filter((type) => type && type !== '*');
}

export function acceptedArtifactTypesForComponent(componentId: string) {
  return Array.from(new Set([
    ...(componentArtifactTypes[normalizeUIComponentId(componentId)] ?? componentArtifactTypes[componentId] ?? []),
    ...(uiComponentAliasAcceptedArtifactTypes[componentId] ?? []),
  ]));
}

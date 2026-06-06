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

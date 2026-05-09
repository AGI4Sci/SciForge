import {
  buildUIComponentArtifactTypeIndex,
  normalizeUIComponentId,
  uiComponentCompatibilityAliases,
  uiComponentManifests,
  type PresentationDedupeScope,
  type UIComponentManifest,
} from '../../../packages/presentation/components';

export type { PresentationDedupeScope };
export type RuntimeUIModule = UIComponentManifest;

export { normalizeUIComponentId };

function compatibilityAliasModule(alias: typeof uiComponentCompatibilityAliases[number]): RuntimeUIModule {
  const target = uiComponentManifests.find((module) => module.componentId === alias.activeComponentId)
    ?? uiComponentManifests.find((module) => module.componentId === alias.routeComponentId);
  return {
    ...(target ?? uiComponentManifests.find((module) => module.componentId === 'unknown-artifact-inspector') ?? uiComponentManifests[0]),
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

export const uiModuleRegistry: RuntimeUIModule[] = Array.from(
  new Map(
    [
      ...uiComponentManifests,
      ...uiComponentCompatibilityAliases.map(compatibilityAliasModule),
    ].map((module) => [`${module.moduleId}@${module.version}:${module.componentId}`, module]),
  ).values(),
);

export const componentArtifactTypes = buildUIComponentArtifactTypeIndex(uiModuleRegistry);

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
    ...(componentArtifactTypes[componentId] ?? componentArtifactTypes[normalizeUIComponentId(componentId)] ?? []),
  ]));
}

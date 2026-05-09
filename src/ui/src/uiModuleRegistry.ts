import {
  buildUIComponentArtifactTypeIndex,
  normalizeUIComponentId,
  uiComponentRuntimeRegistry,
  type PresentationDedupeScope,
  type UIComponentManifest,
} from '../../../packages/presentation/components';

export type { PresentationDedupeScope };
export type RuntimeUIModule = UIComponentManifest;

export { normalizeUIComponentId };

export const uiModuleRegistry: RuntimeUIModule[] = uiComponentRuntimeRegistry;

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

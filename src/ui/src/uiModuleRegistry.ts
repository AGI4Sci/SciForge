import { uiComponentManifests, type PresentationDedupeScope, type UIComponentManifest } from '../../../packages/ui-components';

export type { PresentationDedupeScope };
export type RuntimeUIModule = UIComponentManifest;

export const uiModuleRegistry: RuntimeUIModule[] = uiComponentManifests;

export const componentArtifactTypes: Record<string, string[]> = uiModuleRegistry.reduce<Record<string, string[]>>((acc, module) => {
  const current = acc[module.componentId] ?? [];
  acc[module.componentId] = Array.from(new Set([...current, ...module.acceptsArtifactTypes]));
  return acc;
}, {});

componentArtifactTypes['molecule-viewer-3d'] = componentArtifactTypes['molecule-viewer'] ?? [];

export function artifactTypesForComponents(componentIds: string[]) {
  const componentOutputTypes = uiModuleRegistry.reduce<Record<string, string[]>>((acc, module) => {
    const current = acc[module.componentId] ?? [];
    acc[module.componentId] = Array.from(new Set([...current, ...(module.outputArtifactTypes ?? [])]));
    return acc;
  }, {});
  return Array.from(new Set(componentIds.flatMap((componentId) => componentOutputTypes[componentId] ?? [])))
    .filter((type) => type && type !== '*');
}

export function acceptedArtifactTypesForComponent(componentId: string) {
  return componentArtifactTypes[componentId] ?? [];
}

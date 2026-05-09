import type { UIComponentElement } from './elementTypes';
import {
  buildUIComponentArtifactTypeIndex,
  normalizeUIComponentId,
  type UIComponentManifest,
  uiComponentRuntimeRegistry,
} from '../../../presentation/components';

const componentArtifactTypes = buildUIComponentArtifactTypeIndex(uiComponentRuntimeRegistry);
const componentIdByModuleId = new Map(uiComponentRuntimeRegistry.map((manifest) => [manifest.moduleId, manifest.componentId]));

function acceptedArtifactTypesForComponent(componentId: string) {
  return componentArtifactTypes[componentId] ?? [];
}

export const uiComponentElements: UIComponentElement[] = uiComponentRuntimeRegistry
  .map((manifest, index) => ({ manifest, index }))
  .sort((left, right) => Number(isCompatibilityAlias(right.manifest)) - Number(isCompatibilityAlias(left.manifest)) || left.index - right.index)
  .map(({ manifest }) => uiComponentManifestToElement(manifest));

function uiComponentManifestToElement(manifest: UIComponentManifest): UIComponentElement {
  const acceptedArtifactTypes = acceptedArtifactTypesForComponent(manifest.componentId);
  const primaryArtifactType = acceptedArtifactTypes.find((artifactType) => artifactType !== '*') ?? 'runtime artifact';
  const fallback = fallbackComponentIdForManifest(manifest.fallbackModuleIds?.[0]);
  return {
    id: `component.${manifest.componentId}`,
    kind: 'ui-component',
    version: manifest.version,
    label: manifest.title,
    description: manifest.description,
    source: 'package',
    componentId: manifest.componentId,
    acceptsArtifactTypes: acceptedArtifactTypes,
    requiredFields: requiredFieldsForManifest(manifest),
    emptyState: {
      title: `Awaiting ${primaryArtifactType}`,
      detail: `${manifest.title} requires a compatible ${acceptedArtifactTypes.join('/') || 'runtime artifact'} artifact. Provide matching data or let the runtime UI manifest choose a fallback.`,
    },
    recoverActions: ['inspect-component-manifest', 'provide-compatible-artifact', 'select-supported-component'],
    viewParams: manifest.viewParams ?? [],
    interactionEvents: manifest.interactionEvents ?? [],
    roleDefaults: manifest.roleDefaults ?? [],
    fallback,
  };
}

function requiredFieldsForManifest(manifest: UIComponentManifest) {
  return Array.from(new Set([
    ...(manifest.requiredFields ?? []),
    ...(manifest.requiredAnyFields ?? []).flat(),
  ]));
}

function fallbackComponentIdForManifest(fallbackModuleId?: string) {
  if (!fallbackModuleId) return 'unknown-artifact-inspector';
  if (fallbackModuleId === 'generic-data-table') return 'record-table';
  if (fallbackModuleId === 'generic-artifact-inspector') return 'unknown-artifact-inspector';
  return normalizeUIComponentId(componentIdByModuleId.get(fallbackModuleId) ?? fallbackModuleId);
}

function isCompatibilityAlias(manifest: UIComponentManifest) {
  return normalizeUIComponentId(manifest.componentId) !== manifest.componentId;
}

import type { UIComponentElement } from './elementTypes';
import {
  buildUIComponentArtifactTypeIndex,
  type UIComponentManifest,
  uiComponentRuntimeRegistry,
} from '../../../presentation/components';

const componentArtifactTypes = buildUIComponentArtifactTypeIndex(uiComponentRuntimeRegistry);

function acceptedArtifactTypesForComponent(componentId: string) {
  return componentArtifactTypes[componentId] ?? [];
}

export const uiComponentElements: UIComponentElement[] = uiComponentRuntimeRegistry
  .map((manifest) => uiComponentManifestToElement(manifest));

function uiComponentManifestToElement(manifest: UIComponentManifest): UIComponentElement {
  const acceptedArtifactTypes = acceptedArtifactTypesForComponent(manifest.componentId);
  const primaryArtifactType = acceptedArtifactTypes.find((artifactType) => artifactType !== '*') ?? 'runtime artifact';
  return {
    id: `component.${manifest.componentId}`,
    kind: 'ui-component',
    version: manifest.version,
    label: manifest.title,
    description: manifest.description,
    source: 'package',
    componentId: manifest.componentId,
    acceptsArtifactTypes: acceptedArtifactTypes,
    consumes: consumesForManifest(manifest),
    emptyState: {
      title: `Awaiting ${primaryArtifactType}`,
      detail: `${manifest.title} requires a compatible ${acceptedArtifactTypes.join('/') || 'runtime artifact'} artifact.`,
    },
    recoverActions: ['inspect-component-manifest'],
    viewParams: manifest.viewParams ?? [],
    interactionEvents: manifest.interactionEvents ?? [],
    roleDefaults: manifest.roleDefaults ?? [],
    fallback: '',
  };
}

function consumesForManifest(manifest: UIComponentManifest) {
  return (manifest.consumes ?? []).map((contract) => [
    contract.kinds.join('/'),
    contract.mediaTypes?.join('|'),
    contract.extensions?.map((extension) => `.${extension.replace(/^\./, '')}`).join('|'),
  ].filter(Boolean).join(' '));
}

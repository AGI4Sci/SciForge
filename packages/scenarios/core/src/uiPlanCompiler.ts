import type { ScenarioId, UIManifestSlot } from './contracts';
import { SCENARIO_SPECS } from './scenarioSpecs';
import { elementRegistry } from './elementRegistry';
import type { ArtifactSchemaElement, ElementRegistry, UIComponentElement } from './elementTypes';

export interface UIPlan {
  id: string;
  version: string;
  scenarioId: string;
  slots: UIManifestSlot[];
  fallbacks: {
    unknownArtifact: string;
    missingData: string;
  };
  compiledFrom: {
    artifactTypes: string[];
    componentIds: string[];
  };
  warnings: string[];
}

export function compileUIPlanForScenario(
  scenarioId: ScenarioId,
  registry: ElementRegistry = elementRegistry,
): UIPlan {
  const spec = SCENARIO_SPECS[scenarioId];
  const artifactTypes = spec.outputArtifacts.map((artifact) => artifact.type);
  const slots = spec.defaultSlots.map((slot, index) => {
    const artifact = slot.artifactRef
      ? registry.artifacts.find((item) => item.artifactType === slot.artifactRef)
      : undefined;
    const component = pickComponentForSlot(slot.componentId, artifact, registry.components);
    return {
      ...slot,
      componentId: component.componentId,
      artifactRef: slot.artifactRef ?? artifact?.artifactType,
      priority: slot.priority ?? index + 1,
    };
  });

  const warnings: string[] = [];
  for (const artifactType of artifactTypes) {
    const hasSlot = slots.some((slot) => slot.artifactRef === artifactType);
    if (!hasSlot) warnings.push(`No default slot directly references artifact type: ${artifactType}`);
  }

  return {
    id: `ui-plan.${scenarioId}.default`,
    version: '1.0.0',
    scenarioId,
    slots,
    fallbacks: {
      unknownArtifact: 'unknown-artifact-inspector',
      missingData: 'empty-state-with-reason',
    },
    compiledFrom: {
      artifactTypes,
      componentIds: slots.map((slot) => slot.componentId),
    },
    warnings,
  };
}

export function compileSlotsForScenario(scenarioId: ScenarioId): UIManifestSlot[] {
  return compileUIPlanForScenario(scenarioId).slots;
}

function pickComponentForSlot(
  preferredComponentId: string,
  artifact: ArtifactSchemaElement | undefined,
  components: UIComponentElement[],
) {
  const preferred = components.find((component) => component.componentId === preferredComponentId);
  if (preferred && (!artifact || componentAcceptsArtifact(preferred, artifact.artifactType))) return preferred;
  const specialized = artifact
    ? components.find((component) => component.componentId !== 'unknown-artifact-inspector' && componentAcceptsArtifact(component, artifact.artifactType))
    : undefined;
  return specialized
    ?? components.find((component) => component.componentId === 'data-table')
    ?? components.find((component) => component.componentId === 'unknown-artifact-inspector')
    ?? components[0];
}

function componentAcceptsArtifact(component: UIComponentElement, artifactType: string) {
  return component.acceptsArtifactTypes.includes('*') || component.acceptsArtifactTypes.includes(artifactType);
}

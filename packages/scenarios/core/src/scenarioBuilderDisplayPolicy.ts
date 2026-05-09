import { elementRegistry } from './elementRegistry';
import type { ElementRegistry, UIComponentElement } from './elementTypes';
import type { ScenarioElementSelection } from './scenarioElementCompiler';
import type { SkillDomain } from './scenarioSpecs';

export interface ScenarioBuilderComponentDisplay {
  label: string;
  detail: string;
  meta: string;
}

export interface ScenarioBuilderRecommendationInput {
  selection: Pick<ScenarioElementSelection, 'skillDomain' | 'selectedSkillIds' | 'selectedArtifactTypes'>;
  scenario: {
    skillDomain: SkillDomain;
    fallbackComponent?: string;
  };
  uiSlotCount: number;
  skillStepCount: number;
}

export const scenarioBuilderQualityChecklistText = '发布前会检查 producer/consumer、fallback、runtime profile 和 package quality gate。';

export function scenarioBuilderRecommendationReasons(
  input: ScenarioBuilderRecommendationInput,
  registry: ElementRegistry = elementRegistry,
) {
  const domain = input.selection.skillDomain ?? input.scenario.skillDomain;
  const fallbackDisplay = componentPolicyDisplay(input.scenario.fallbackComponent, registry);
  return [
    `skill domain ${domain} 决定默认 skill/tool/profile 搜索空间。`,
    `${input.selection.selectedSkillIds.length} 个 skill 覆盖 ${input.selection.selectedArtifactTypes.length} 个 artifact contract。`,
    `${input.uiSlotCount} 个 UI slot 由已选 artifact consumer 自动编译；未匹配 artifact 交给 ${fallbackDisplay.label} (${fallbackDisplay.componentId})。`,
    `${input.skillStepCount} 个 skill step 会进入 package metadata，便于后续 diff 和复现。`,
  ];
}

export function scenarioBuilderComponentDisplay(
  componentId: string,
  registry: ElementRegistry = elementRegistry,
): ScenarioBuilderComponentDisplay {
  const component = registry.components.find((item) => item.componentId === componentId);
  if (!component) {
    const display = componentPolicyDisplay(undefined, registry);
    return {
      label: componentId,
      detail: `未注册组件将按 ${display.label} (${display.componentId}) 的 package manifest policy 处理。`,
      meta: `producer/consumer unknown · package policy ${display.componentId}`,
    };
  }

  return {
    label: component.label,
    detail: component.description,
    meta: componentManifestMeta(component),
  };
}

function componentPolicyDisplay(componentId: string | undefined, registry: ElementRegistry) {
  const component = componentId
    ? registry.components.find((item) => item.componentId === componentId)
    : undefined;
  const fallbackComponent = component
    ?? registry.components.find((item) => item.componentId === 'unknown-artifact-inspector')
    ?? registry.components.find((item) => item.acceptsArtifactTypes.includes('*'))
    ?? registry.components[0];
  return {
    componentId: fallbackComponent?.componentId ?? componentId ?? 'unregistered-component',
    label: fallbackComponent?.label ?? componentId ?? 'Unregistered component',
  };
}

function componentManifestMeta(component: UIComponentElement) {
  const accepted = component.acceptsArtifactTypes.join(', ') || '*';
  const requiredFields = component.requiredFields.join(', ') || 'none';
  const fallbackPolicy = component.fallback || 'component manifest default';
  return `accepts ${accepted} · fields ${requiredFields} · fallback ${fallbackPolicy}`;
}

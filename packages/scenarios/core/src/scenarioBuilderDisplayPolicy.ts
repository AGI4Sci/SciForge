import { elementRegistry } from './elementRegistry';
import type { ArtifactSchemaElement, ElementRegistry, SkillElement, UIComponentElement } from './elementTypes';
import type { ScenarioBuilderDraft } from './scenarioDraftCompiler';
import type { ScenarioElementSelection } from './scenarioElementCompiler';
import type { ScenarioId } from './contracts';
import { SCENARIO_SPECS, type ScenarioArtifactSchema, type SkillDomain } from './scenarioSpecs';
import { scenarioIdBySkillDomain } from './scenarioRoutingPolicy';

export interface ScenarioBuilderComponentDisplay {
  label: string;
  detail: string;
  meta: string;
}

export interface ScenarioDisplayToken {
  id: string;
  label: string;
  detail?: string;
}

export interface ScenarioDomainFilterOption {
  value: SkillDomain;
  label: string;
  scenarioTitle: string;
}

export interface ScenarioDashboardAction {
  scenarioId: ScenarioId;
  label: string;
}

export interface ScenarioPackagePreviewField {
  label: string;
  value: string;
}

export interface ScenarioBuilderDraftPreviewModel {
  title: string;
  summary: string;
  componentTokens: ScenarioDisplayToken[];
  artifactTokens: ScenarioDisplayToken[];
  skillTokens: ScenarioDisplayToken[];
  scenarioMarkdown: string;
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
export const scenarioBuilderDefaultPrompt = '我想比较KRAS G12D突变相关文献证据，并在需要时联动蛋白结构和知识图谱。';
export const scenarioBuilderPromptPlaceholder = '例如：帮我构建一个场景，读取单细胞表达矩阵，比较处理组和对照组，并展示火山图、热图和UMAP。';
export const scenarioDashboardPrimaryImportAction: ScenarioDashboardAction = {
  scenarioId: scenarioIdBySkillDomain.literature,
  label: '导入文献场景',
};

export function scenarioSkillDomainFilterOptions(): ScenarioDomainFilterOption[] {
  return Object.entries(scenarioIdBySkillDomain).map(([value, scenarioId]) => ({
    value: value as SkillDomain,
    label: value,
    scenarioTitle: SCENARIO_SPECS[scenarioId].title,
  }));
}

export function scenarioSkillDomainDisplayLabel(value: string) {
  const match = scenarioSkillDomainFilterOptions().find((option) => option.value === value);
  return match?.label ?? value;
}

export function scenarioPackagePreviewFields(input: {
  title: string;
  skillDomain: string;
  qualityLabel: string;
  exportFileName: string;
}): ScenarioPackagePreviewField[] {
  return [
    { label: 'scenario', value: input.title },
    { label: 'domain', value: scenarioSkillDomainDisplayLabel(input.skillDomain) },
    { label: 'quality', value: input.qualityLabel },
    { label: 'export file', value: input.exportFileName },
  ];
}

export function scenarioPackageExportFileName(input: { id: string; version: string }) {
  return `${input.id}-${input.version}.scenario-package.json`;
}

export function scenarioBuilderDraftPreviewModel(
  draft: ScenarioBuilderDraft,
  registry: ElementRegistry = elementRegistry,
): ScenarioBuilderDraftPreviewModel {
  return {
    title: draft.title,
    summary: `${draft.summary} · confidence ${Math.round(draft.confidence * 100)}%`,
    componentTokens: draft.defaultComponents.map((componentId) => componentDisplayToken(componentId, registry)),
    artifactTokens: (draft.recommendedArtifactTypes ?? []).map((artifactType) => artifactDisplayToken(artifactType, registry)),
    skillTokens: (draft.recommendedSkillIds ?? []).slice(0, 4).map((skillId) => skillDisplayToken(skillId, registry)),
    scenarioMarkdown: draft.scenarioMarkdown,
  };
}

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

function componentDisplayToken(componentId: string, registry: ElementRegistry): ScenarioDisplayToken {
  const display = scenarioBuilderComponentDisplay(componentId, registry);
  return { id: componentId, label: display.label, detail: display.detail };
}

function artifactDisplayToken(artifactType: string, registry: ElementRegistry): ScenarioDisplayToken {
  const artifact = registry.artifacts.find((item: ArtifactSchemaElement) => item.artifactType === artifactType);
  const scenarioArtifact = scenarioArtifactForType(artifactType);
  return {
    id: artifactType,
    label: artifact?.label !== artifactType ? artifact?.label ?? scenarioArtifact?.description ?? artifactType : scenarioArtifact?.description ?? artifactType,
    detail: (artifact?.fields ?? scenarioArtifact?.fields)?.map((field) => field.key).join(', '),
  };
}

function scenarioArtifactForType(artifactType: string): ScenarioArtifactSchema | undefined {
  for (const spec of Object.values(SCENARIO_SPECS)) {
    const match = (spec.outputArtifacts as readonly ScenarioArtifactSchema[]).find((item) => item.type === artifactType);
    if (match) return match;
  }
  return undefined;
}

function skillDisplayToken(skillId: string, registry: ElementRegistry): ScenarioDisplayToken {
  const skill = registry.skills.find((item: SkillElement) => item.id === skillId);
  return {
    id: skillId,
    label: skill?.label ?? skillId,
    detail: skill?.description,
  };
}

function componentManifestMeta(component: UIComponentElement) {
  const accepted = component.acceptsArtifactTypes.join(', ') || '*';
  const requiredFields = component.requiredFields.join(', ') || 'none';
  const fallbackPolicy = component.fallback || 'component manifest default';
  return `accepts ${accepted} · fields ${requiredFields} · fallback ${fallbackPolicy}`;
}

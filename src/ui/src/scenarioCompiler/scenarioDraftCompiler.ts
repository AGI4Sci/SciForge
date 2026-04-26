import type { ScenarioId } from '../data';
import type { ScenarioRuntimeOverride } from '../domain';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { inferDomainFromText, recommendScenarioElements } from './scenarioElementCompiler';

export type ScenarioBuilderDraft = ScenarioRuntimeOverride & {
  baseScenarioId: ScenarioId;
  confidence: number;
  summary: string;
  recommendedSkillIds: string[];
  recommendedArtifactTypes: string[];
  recommendedComponentIds: string[];
  recommendationReasons: string[];
};

export const scenarioIdBySkillDomain: Record<ScenarioRuntimeOverride['skillDomain'], ScenarioId> = {
  literature: 'literature-evidence-review',
  structure: 'structure-exploration',
  omics: 'omics-differential-exploration',
  knowledge: 'biomedical-knowledge-graph',
};

export function compileScenarioDraft(description: string): ScenarioBuilderDraft {
  const text = description.trim();
  const normalized = text.toLowerCase();
  const skillDomain = inferDomainFromText(normalized);
  const baseScenarioId = scenarioIdBySkillDomain[skillDomain];
  const base = SCENARIO_SPECS[baseScenarioId];
  const titleSeed = text.replace(/[。.!?？\n].*$/s, '').trim().slice(0, 24);
  const recommendation = recommendScenarioElements(text || base.description);
  const defaultComponents = recommendation.selectedComponentIds.length
    ? mergeRecommendedComponents(recommendation.selectedComponentIds, base.componentPolicy.defaultComponents)
    : base.componentPolicy.defaultComponents;
  const outputArtifacts = recommendation.selectedArtifactTypes.length
    ? recommendation.selectedArtifactTypes
    : base.outputArtifacts.map((item) => item.type);
  const recommendedSkills = recommendation.selectedSkillIds;
  return {
    baseScenarioId,
    confidence: text.length > 18 ? 0.82 : 0.62,
    summary: `${base.title} · ${defaultComponents.join(' / ')} · ${outputArtifacts.join(' / ')}`,
    title: titleSeed ? `${titleSeed}场景` : base.title,
    description: text || base.description,
    skillDomain,
    defaultComponents,
    allowedComponents: Array.from(new Set([...base.componentPolicy.allowedComponents, ...defaultComponents])),
    fallbackComponent: base.componentPolicy.fallbackComponent,
    scenarioMarkdown: [
      `# ${titleSeed || base.title}`,
      '',
      `用户目标：${text || base.description}`,
      '',
      `默认展示：${defaultComponents.join('、')}。`,
      '',
      `推荐 skills：${recommendedSkills.join('、') || 'agent backend native capability'}。`,
      '',
      `输入线索：${base.inputContract.map((item) => item.key).join('、')}。`,
      '',
      `输出 artifact：${outputArtifacts.join('、')}。`,
      '',
      `边界：${base.scopeDeclaration.unsupportedTasks.slice(0, 3).join('；')}。`,
    ].join('\n'),
    recommendedSkillIds: recommendedSkills,
    recommendedArtifactTypes: outputArtifacts,
    recommendedComponentIds: defaultComponents,
    recommendationReasons: recommendation.reasons,
  };
}

function mergeRecommendedComponents(recommended: string[], baseDefaults: string[]) {
  return Array.from(new Set([
    ...recommended.filter((componentId) => componentId !== 'unknown-artifact-inspector'),
    ...baseDefaults,
    'unknown-artifact-inspector',
  ]));
}

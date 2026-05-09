import type { SciForgeSharedSkillDomain } from './handoff';

const DEFAULT_ARTIFACT_TYPE_BY_SKILL_DOMAIN: Record<SciForgeSharedSkillDomain, string> = {
  literature: 'paper-list',
  structure: 'structure-summary',
  omics: 'omics-differential-expression',
  knowledge: 'knowledge-graph',
};

export function defaultArtifactSchemaForSkillDomain(skillDomain: SciForgeSharedSkillDomain): Record<string, unknown> {
  return { type: DEFAULT_ARTIFACT_TYPE_BY_SKILL_DOMAIN[skillDomain] };
}

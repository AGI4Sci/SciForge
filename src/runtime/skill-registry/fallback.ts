import { backendGenerationSkillAvailability } from '../../../packages/skills/runtime-policy.js';
import type { SciForgeSkillDomain, SkillAvailability } from '../runtime-types.js';

export function agentServerGenerationSkill(skillDomain: SciForgeSkillDomain): SkillAvailability {
  return backendGenerationSkillAvailability(skillDomain, new Date().toISOString()) as SkillAvailability;
}

import { scoreSkillByPackagePolicy, selectSkillByPackagePolicy, skillAllowedByPackagePolicy } from '../../../packages/skills/matching-policy';
import type { GatewayRequest, SciForgeSkillDomain, SkillAvailability, SkillManifest } from '../runtime-types.js';

export function matchSkill(request: GatewayRequest, skills: SkillAvailability[]): SkillAvailability | undefined {
  const allowed = new Set(request.availableSkills?.filter(Boolean) ?? []);
  const prompt = request.prompt.toLowerCase();
  const scored = skills
    .filter((skill) => skill.available)
    .filter((skill) => !allowed.size || allowed.has(skill.id))
    .filter((skill) => skill.manifest.skillDomains.includes(request.skillDomain))
    .filter((skill) => skill.manifest.entrypoint.type !== 'inspector' || request.artifacts.length > 0)
    .filter((skill) => skillAllowedByPackagePolicy(skill, prompt))
    .map((skill) => ({ skill, score: scoreSkill(skill.manifest, request.skillDomain, prompt) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || priority(left.skill.kind) - priority(right.skill.kind));
  return selectSkillByPackagePolicy(scored);
}

export function scoreSkill(manifest: SkillManifest, skillDomain: SciForgeSkillDomain, prompt: string) {
  return scoreSkillByPackagePolicy(manifest, skillDomain, prompt);
}

function priority(kind: SkillManifest['kind']) {
  return kind === 'package' ? 0 : kind === 'workspace' ? 1 : kind === 'installed' ? 2 : 3;
}

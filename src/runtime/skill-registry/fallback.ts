import type { SciForgeSkillDomain, SkillAvailability } from '../runtime-types.js';

export function agentServerGenerationSkill(skillDomain: SciForgeSkillDomain): SkillAvailability {
  const checkedAt = new Date().toISOString();
  return {
    id: `agentserver.generate.${skillDomain}`,
    kind: 'package',
    available: true,
    reason: 'No executable skill matched; caller should fall through to AgentServer task generation.',
    checkedAt,
    manifestPath: 'agentserver://generation',
    manifest: {
      id: `agentserver.generate.${skillDomain}`,
      kind: 'package',
      description: 'Generic AgentServer task generation fallback.',
      skillDomains: [skillDomain],
      inputContract: { prompt: 'string', workspacePath: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: 'agentserver-generation' },
      environment: { runtime: 'AgentServer' },
      validationSmoke: { mode: 'delegated' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

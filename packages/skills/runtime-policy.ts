import { dirname, resolve } from 'node:path';

export type SkillPackageDomain = 'literature' | 'structure' | 'omics' | 'knowledge';

export interface RuntimePolicySkillManifest {
  id: string;
  kind: 'package' | 'workspace' | 'installed';
  description: string;
  skillDomains: SkillPackageDomain[];
  inputContract: Record<string, unknown>;
  outputArtifactSchema: Record<string, unknown>;
  entrypoint: {
    type: 'workspace-task' | 'inspector' | 'agentserver-generation' | 'markdown-skill';
    command?: string;
    path?: string;
  };
  environment: Record<string, unknown>;
  validationSmoke: Record<string, unknown>;
  examplePrompts: string[];
  promotionHistory: Array<Record<string, unknown>>;
  scopeDeclaration?: Record<string, unknown>;
}

export interface RuntimePolicySkillAvailability {
  id: string;
  kind: RuntimePolicySkillManifest['kind'];
  available: boolean;
  reason: string;
  checkedAt: string;
  manifestPath: string;
  manifest: RuntimePolicySkillManifest;
}

export interface SkillAvailabilityFileProbe {
  id: string;
  path: string;
  unavailableReason: string;
}

export interface SkillAvailabilityValidationPlan {
  missingFields: string[];
  missingDomainsReason?: string;
  fileProbes: SkillAvailabilityFileProbe[];
}

export function planSkillAvailabilityValidation(
  manifest: RuntimePolicySkillManifest,
  context: { manifestPath: string; cwd: string },
): SkillAvailabilityValidationPlan {
  return {
    missingFields: requiredManifestFields
      .filter((key) => !(key in manifest) || manifest[key] === undefined || manifest[key] === ''),
    missingDomainsReason: manifest.skillDomains.length ? undefined : 'Manifest skillDomains is empty',
    fileProbes: entrypointFileProbes(manifest, context),
  };
}

export function skillAvailabilityFailureReason(
  plan: SkillAvailabilityValidationPlan,
  failedProbe?: SkillAvailabilityFileProbe,
): string | undefined {
  if (plan.missingFields.length) return `Manifest missing ${plan.missingFields.join(', ')}`;
  if (plan.missingDomainsReason) return plan.missingDomainsReason;
  return failedProbe?.unavailableReason;
}

export function agentServerGenerationSkillAvailability(
  skillDomain: SkillPackageDomain,
  checkedAt: string,
): RuntimePolicySkillAvailability {
  return {
    id: `agentserver.generate.${skillDomain}`,
    kind: 'package',
    available: true,
    reason: 'No executable skill matched; caller should fall through to AgentServer task generation.',
    checkedAt,
    manifestPath: '@sciforge/skills/runtime-policy#agentserver-generation',
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

const requiredManifestFields: Array<keyof RuntimePolicySkillManifest> = [
  'id',
  'description',
  'inputContract',
  'outputArtifactSchema',
  'entrypoint',
  'environment',
  'validationSmoke',
  'examplePrompts',
  'promotionHistory',
];

function entrypointFileProbes(
  manifest: RuntimePolicySkillManifest,
  context: { manifestPath: string; cwd: string },
): SkillAvailabilityFileProbe[] {
  if (manifest.entrypoint.type === 'workspace-task' && manifest.entrypoint.path) {
    const entrypointPath = resolve(dirname(context.manifestPath), manifest.entrypoint.path);
    return [{
      id: 'entrypoint',
      path: entrypointPath,
      unavailableReason: `Entrypoint not found: ${entrypointPath}`,
    }];
  }
  if (manifest.entrypoint.type === 'markdown-skill' && manifest.entrypoint.path) {
    const markdownPath = resolve(context.cwd, manifest.entrypoint.path);
    return [{
      id: 'markdown-skill',
      path: markdownPath,
      unavailableReason: `Markdown skill not found: ${manifest.entrypoint.path}`,
    }];
  }
  return [];
}

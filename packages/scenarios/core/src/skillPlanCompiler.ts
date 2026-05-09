import { runtimeCapabilityProfiles, type RuntimeCapabilityProfile } from './runtimeCapabilityProfiles';
import type { CapabilityRequirement, ElementRegistry, SkillElement } from './elementTypes';
import { elementRegistry } from './elementRegistry';

export interface SkillIR {
  skillId: string;
  intent: string;
  inputs: string[];
  requiredCapabilities: CapabilityRequirement[];
  executionGraph: Array<{
    node: string;
    tool?: string;
    dependsOn?: string[];
    artifactType?: string;
  }>;
  artifactOutputs: string[];
  uiContracts: string[];
  failureModes: string[];
}

export interface SkillPlan {
  id: string;
  version: string;
  skillIRs: SkillIR[];
  routeOptions: Array<{
    skillId: string;
    runtimeProfileId: string;
    supportedCapabilities: string[];
    missingCapabilities: string[];
    priority: number;
  }>;
  runtimePriority: string[];
  fallbackPolicyIds: string[];
}

export function compileSkillIR(skill: SkillElement, registry: ElementRegistry = elementRegistry): SkillIR {
  const outputArtifacts = skill.outputArtifactTypes;
  const uiContracts = registry.components
    .filter((component) => outputArtifacts.some((artifactType) => component.acceptsArtifactTypes.includes(artifactType) || component.acceptsArtifactTypes.includes('*')))
    .map((component) => component.componentId);
  return {
    skillId: skill.id,
    intent: skill.description,
    inputs: Object.keys(skill.inputContract),
    requiredCapabilities: skill.requiredCapabilities,
    executionGraph: [
      {
        node: `${skill.id}.run`,
        tool: skill.entrypointType,
      },
      ...outputArtifacts.map((artifactType) => ({
        node: `${skill.id}.emit.${artifactType}`,
        artifactType,
        dependsOn: [`${skill.id}.run`],
      })),
    ],
    artifactOutputs: outputArtifacts,
    uiContracts,
    failureModes: skill.failureModes,
  };
}

export function compileSkillPlan(
  skillIds: string[],
  registry: ElementRegistry = elementRegistry,
  profiles: RuntimeCapabilityProfile[] = runtimeCapabilityProfiles,
): SkillPlan {
  const skills = skillIds.flatMap((skillId) => {
    const skill = registry.skills.find((item) => item.id === skillId);
    return skill ? [skill] : [];
  });
  const skillIRs = skills.map((skill) => compileSkillIR(skill, registry));
  const routeOptions = skills.flatMap((skill) => profiles.map((profile) => {
    const supportedCapabilities = skill.requiredCapabilities
      .filter((capability) => profileSupports(profile, capability.capability))
      .map((capability) => capability.capability);
    const missingCapabilities = skill.requiredCapabilities
      .filter((capability) => !profileSupports(profile, capability.capability))
      .map((capability) => capability.capability);
    return {
      skillId: skill.id,
      runtimeProfileId: profile.id,
      supportedCapabilities,
      missingCapabilities,
      priority: profile.runtimePriority + missingCapabilities.length * 10,
    };
  })).sort((left, right) => left.priority - right.priority || left.skillId.localeCompare(right.skillId));

  return {
    id: `skill-plan.${stableHash(skillIds.join(':'))}`,
    version: '1.0.0',
    skillIRs,
    routeOptions,
    runtimePriority: profiles.slice().sort((left, right) => left.runtimePriority - right.runtimePriority).map((profile) => profile.id),
    fallbackPolicyIds: ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'],
  };
}

function profileSupports(profile: RuntimeCapabilityProfile, capability: string) {
  const level = profile.capabilities[capability];
  return Boolean(level && level !== 'none');
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

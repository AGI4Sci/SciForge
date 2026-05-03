import type { ElementRegistry, RegistryValidationIssue } from './elementTypes';
import { elementRegistry } from './elementRegistry';
import type { ScenarioPackage } from './scenarioPackage';

export interface ValidationReport {
  ok: boolean;
  issues: RegistryValidationIssue[];
  checkedAt: string;
}

export function validateScenarioPackage(
  pkg: ScenarioPackage,
  registry: ElementRegistry = elementRegistry,
  checkedAt = new Date().toISOString(),
): ValidationReport {
  const issues: RegistryValidationIssue[] = [];
  const artifactTypes = new Set(registry.artifacts.map((artifact) => artifact.artifactType));
  const componentIds = new Set(registry.components.map((component) => component.componentId));
  const skillIds = new Set(registry.skills.map((skill) => skill.id));
  const toolIds = new Set(registry.tools.map((tool) => tool.id));
  const failurePolicyIds = new Set(registry.failurePolicies.map((policy) => policy.id));

  for (const artifact of pkg.scenario.outputArtifacts) {
    if (!artifactTypes.has(artifact.type)) {
      issues.push({ severity: 'error', code: 'unknown-artifact-schema', message: `Unknown artifact schema: ${artifact.type}`, elementId: artifact.type });
    }
    const producer = registry.artifacts.find((item) => item.artifactType === artifact.type)?.producerSkillIds ?? [];
    if (!producer.some((skillId) => pkg.scenario.selectedSkillIds.includes(skillId))) {
      issues.push({ severity: 'error', code: 'missing-selected-producer', message: `No selected skill produces artifact: ${artifact.type}`, elementId: artifact.type });
    }
  }

  for (const skillId of pkg.scenario.selectedSkillIds) {
    if (!skillIds.has(skillId)) {
      issues.push({ severity: 'error', code: 'unknown-skill', message: `Unknown selected skill: ${skillId}`, elementId: skillId });
    }
  }

  for (const toolId of pkg.scenario.selectedToolIds) {
    if (!toolIds.has(toolId)) {
      issues.push({ severity: 'warning', code: 'unknown-tool', message: `Unknown selected tool: ${toolId}`, elementId: toolId });
    }
  }

  for (const slot of pkg.uiPlan.slots) {
    if (!componentIds.has(slot.componentId)) {
      issues.push({ severity: 'error', code: 'unknown-ui-component', message: `Unknown UI component: ${slot.componentId}`, elementId: slot.componentId });
    }
    if (slot.artifactRef && !pkg.scenario.outputArtifacts.some((artifact) => artifact.type === slot.artifactRef)) {
      issues.push({ severity: 'warning', code: 'slot-artifact-not-produced-by-scenario', message: `${slot.componentId} references artifact outside scenario outputs: ${slot.artifactRef}`, elementId: slot.componentId });
    }
  }

  if (!componentIds.has(pkg.scenario.fallbackComponentId)) {
    issues.push({ severity: 'error', code: 'missing-scenario-fallback', message: `Scenario fallback component is missing: ${pkg.scenario.fallbackComponentId}`, elementId: pkg.scenario.fallbackComponentId });
  }

  for (const policyId of pkg.skillPlan.fallbackPolicyIds) {
    if (!failurePolicyIds.has(policyId)) {
      issues.push({ severity: 'error', code: 'unknown-failure-policy', message: `Unknown failure policy: ${policyId}`, elementId: policyId });
    }
  }

  if (!pkg.tests.length) {
    issues.push({ severity: 'warning', code: 'missing-smoke-test', message: 'Scenario package has no smoke tests.' });
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    checkedAt,
  };
}


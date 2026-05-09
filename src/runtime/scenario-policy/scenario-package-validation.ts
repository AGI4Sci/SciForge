import { elementRegistry } from '@sciforge/scenario-core/element-registry';
import type { ElementRegistry, RegistryValidationIssue } from '@sciforge/scenario-core/element-types';
import type { ScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { validateUIPlanAgainstScenario } from '@sciforge/scenario-core/ui-plan-compiler';
import { SCENARIO_VALIDATION_ISSUE_CODES, SCENARIO_VALIDATION_MESSAGES } from '@sciforge/scenario-core/validation-issue-policy';

import { findScenarioPackagePolicyOnlyViolations } from './scenario-package-policy.js';

export interface ScenarioPackageValidationReport {
  ok: boolean;
  issues: RegistryValidationIssue[];
  checkedAt: string;
}

export function validateRuntimeScenarioPackage(
  pkg: ScenarioPackage,
  registry: ElementRegistry = elementRegistry,
  checkedAt = new Date().toISOString(),
): ScenarioPackageValidationReport {
  const issues: RegistryValidationIssue[] = [];
  const artifactTypes = new Set(registry.artifacts.map((artifact) => artifact.artifactType));
  const skillIds = new Set(registry.skills.map((skill) => skill.id));
  const toolIds = new Set(registry.tools.map((tool) => tool.id));
  const failurePolicyIds = new Set(registry.failurePolicies.map((policy) => policy.id));

  for (const artifact of pkg.scenario.outputArtifacts) {
    if (!artifactTypes.has(artifact.type)) {
      issues.push({ severity: 'error', code: SCENARIO_VALIDATION_ISSUE_CODES.unknownArtifactSchema, message: SCENARIO_VALIDATION_MESSAGES.unknownArtifactSchema(artifact.type), elementId: artifact.type });
    }
    const producer = registry.artifacts.find((item) => item.artifactType === artifact.type)?.producerSkillIds ?? [];
    if (!producer.some((skillId) => pkg.scenario.selectedSkillIds.includes(skillId))) {
      issues.push({ severity: 'error', code: SCENARIO_VALIDATION_ISSUE_CODES.missingSelectedProducer, message: SCENARIO_VALIDATION_MESSAGES.missingSelectedProducer(artifact.type), elementId: artifact.type });
    }
  }

  for (const skillId of pkg.scenario.selectedSkillIds) {
    if (!skillIds.has(skillId)) {
      issues.push({ severity: 'error', code: SCENARIO_VALIDATION_ISSUE_CODES.unknownSkill, message: SCENARIO_VALIDATION_MESSAGES.unknownSkill(skillId), elementId: skillId });
    }
  }

  for (const toolId of pkg.scenario.selectedToolIds) {
    if (!toolIds.has(toolId)) {
      issues.push({ severity: 'warning', code: SCENARIO_VALIDATION_ISSUE_CODES.unknownTool, message: SCENARIO_VALIDATION_MESSAGES.unknownTool(toolId), elementId: toolId });
    }
  }

  issues.push(...validateUIPlanAgainstScenario(pkg.scenario, pkg.uiPlan, registry));

  for (const policyId of pkg.skillPlan.fallbackPolicyIds) {
    if (!failurePolicyIds.has(policyId)) {
      issues.push({ severity: 'error', code: SCENARIO_VALIDATION_ISSUE_CODES.unknownFailurePolicy, message: SCENARIO_VALIDATION_MESSAGES.unknownFailurePolicy(policyId), elementId: policyId });
    }
  }

  if (!pkg.tests.length) {
    issues.push({ severity: 'warning', code: SCENARIO_VALIDATION_ISSUE_CODES.missingSmokeTest, message: SCENARIO_VALIDATION_MESSAGES.missingSmokeTest });
  }

  for (const violation of findScenarioPackagePolicyOnlyViolations(pkg)) {
    issues.push({
      severity: 'error',
      code: SCENARIO_VALIDATION_ISSUE_CODES.policyOnlyViolation,
      message: violation,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    checkedAt,
  };
}

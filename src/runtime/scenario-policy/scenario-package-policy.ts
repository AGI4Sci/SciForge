import {
  SCENARIO_PACKAGE_POLICY_FIELDS,
  type ScenarioIR,
  type ScenarioPackage,
  type ScenarioPackagePolicy,
} from '@sciforge/scenario-core/scenario-package';
import type { ScenarioSpec } from '@sciforge/scenario-core/scenario-specs';
import type { SkillPlan } from '@sciforge/scenario-core/skill-plan-compiler';
import type { UIPlan } from '@sciforge/scenario-core/ui-plan-compiler';

export interface ScenarioPackagePolicyOptions {
  dynamicPlugins?: ScenarioSpec['componentPolicy']['dynamicPlugins'];
  restrictedDataClasses?: string[];
}

export function buildScenarioPackagePolicy(
  scenario: ScenarioIR,
  skillPlan: SkillPlan,
  uiPlan: UIPlan,
  options: ScenarioPackagePolicyOptions = {},
): ScenarioPackagePolicy {
  return {
    artifactSchemas: scenario.outputArtifacts,
    defaultViews: uiPlan.slots,
    capabilities: {
      requiredSkillIds: scenario.selectedSkillIds,
      allowedSkillIds: scenario.selectedSkillIds,
      allowedToolIds: scenario.selectedToolIds,
      allowedComponentIds: scenario.selectedComponentIds,
      fallbackComponentId: scenario.fallbackComponentId,
      dynamicPlugins: options.dynamicPlugins ?? 'disabled-by-default',
    },
    domainVocabulary: {
      skillDomain: scenario.skillDomain,
      inputKeys: scenario.inputContract.map((field) => field.key),
      artifactTypes: scenario.outputArtifacts.map((artifact) => artifact.type),
      componentIds: scenario.selectedComponentIds,
      supportedTasks: scenario.scopeDeclaration.supportedTasks,
      unsupportedTasks: scenario.scopeDeclaration.unsupportedTasks,
      handoffTargets: scenario.scopeDeclaration.handoffTargets,
    },
    verifierPolicy: {
      requiredInputs: scenario.inputContract.filter((field) => field.required).map((field) => field.key),
      requiredArtifactTypes: scenario.outputArtifacts.map((artifact) => artifact.type),
      requiredArtifactFields: Object.fromEntries(
        scenario.outputArtifacts.map((artifact) => [
          artifact.type,
          artifact.fields.filter((field) => field.required).map((field) => field.key),
        ]),
      ),
      failurePolicyIds: skillPlan.fallbackPolicyIds,
      evidenceBoundaries: [
        ...scenario.scopeDeclaration.unsupportedTasks,
        ...scenario.scopeDeclaration.phaseLimitations,
      ],
    },
    privacySafetyBoundaries: {
      unsupportedTasks: scenario.scopeDeclaration.unsupportedTasks,
      phaseLimitations: scenario.scopeDeclaration.phaseLimitations,
      restrictedDataClasses: options.restrictedDataClasses ?? [],
      safetyNotes: [
        'Scenario packages declare policy only; runtime execution code belongs to capabilities, tools, or backend adapters.',
        'Scenario packages must not route by prompt regex; dispatch uses declared artifacts, views, capabilities, and verifier policy.',
      ],
    },
  };
}

export function withScenarioPackagePolicy(
  pkg: ScenarioPackage,
  options: ScenarioPackagePolicyOptions = {},
): ScenarioPackage {
  return {
    ...pkg,
    policy: buildScenarioPackagePolicy(pkg.scenario, pkg.skillPlan, pkg.uiPlan, options),
  };
}

const disallowedScenarioPackagePolicyKeys = new Set([
  'backendbranch',
  'backendbranches',
  'backendprovider',
  'backendrouting',
  'conversationrouter',
  'command',
  'execute',
  'executor',
  'followupintent',
  'followupmatcher',
  'handler',
  'modelbranch',
  'modelbranches',
  'modelprovider',
  'multiturn',
  'multiturnjudge',
  'multiturnsemanticjudge',
  'promptmatcher',
  'promptpattern',
  'promptcase',
  'promptcases',
  'promptregex',
  'promptspecialcase',
  'promptspecialcases',
  'provider',
  'providerbranch',
  'providerbranches',
  'providerrouting',
  'regexp',
  'regex',
  'runtimecode',
  'semanticclassifier',
  'semanticdecision',
  'semanticjudge',
  'semanticjudgment',
  'semanticmatcher',
  'semanticrouter',
  'semanticrouting',
  'script',
  'shell',
  'sourcecode',
]);

const allowedPolicyFields = new Set<string>(SCENARIO_PACKAGE_POLICY_FIELDS);

export function findScenarioPackagePolicyOnlyViolations(pkg: unknown): string[] {
  const violations: string[] = [];
  if (!isRecord(pkg)) return ['scenario package must be a JSON object'];

  const policy = pkg.policy;
  if (policy !== undefined) {
    if (!isRecord(policy)) {
      violations.push('policy must be a JSON object when present');
    } else {
      for (const key of Object.keys(policy)) {
        if (!allowedPolicyFields.has(key)) {
          violations.push(`policy.${key} is not an allowed scenario package policy field`);
        }
      }
    }
  }

  scanScenarioPackagePolicyOnlyViolations(pkg, [], violations);
  return [...new Set(violations)];
}

function scanScenarioPackagePolicyOnlyViolations(value: unknown, path: string[], violations: string[]) {
  if (typeof value === 'function') {
    violations.push(`${formatPath(path)} contains executable function value`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanScenarioPackagePolicyOnlyViolations(item, [...path, String(index)], violations));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_]/g, '').toLowerCase();
    const childPath = [...path, key];
    if (disallowedScenarioPackagePolicyKeys.has(normalizedKey)) {
      violations.push(`${formatPath(childPath)} uses a disallowed execution, prompt-regex, provider, or semantic routing field`);
    }
    scanScenarioPackagePolicyOnlyViolations(child, childPath, violations);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(path: string[]) {
  return path.length ? path.join('.') : '<root>';
}

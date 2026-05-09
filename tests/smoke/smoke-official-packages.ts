import assert from 'node:assert/strict';

import { scenarios, type ScenarioId } from '../../src/ui/src/data';
import {
  buildBuiltInScenarioPackage,
  SCENARIO_PACKAGE_POLICY_FIELDS,
} from '@sciforge/scenario-core/scenario-package';
import {
  findScenarioPackagePolicyOnlyViolations,
  withScenarioPackagePolicy,
} from '../../src/runtime/scenario-policy/scenario-package-policy.js';
import { validateRuntimeScenarioPackage } from '../../src/runtime/scenario-policy/scenario-package-validation.js';
import { runScenarioRuntimeSmoke } from './scenario-runtime-smoke-harness';

const scenarioIds = scenarios.map((scenario) => scenario.id);

for (const scenarioId of scenarioIds) {
  const pkg = withScenarioPackagePolicy(buildBuiltInScenarioPackage(scenarioId as ScenarioId, '2026-04-25T00:00:00.000Z'));
  const validation = validateRuntimeScenarioPackage(pkg);
  assert.equal(validation.ok, true, `${scenarioId} package should pass validation`);
  assert.equal(pkg.status, 'published', `${scenarioId} package should be published`);
  assert.equal(pkg.scenario.id, scenarioId);
  assert.ok(pkg.policy, `${scenarioId} package should expose policy-only scenario declarations`);
  assert.deepEqual(
    Object.keys(pkg.policy).sort(),
    [...SCENARIO_PACKAGE_POLICY_FIELDS].sort(),
    `${scenarioId} package policy should only expose allowed policy fields`,
  );
  assert.deepEqual(pkg.policy.artifactSchemas, pkg.scenario.outputArtifacts);
  assert.deepEqual(pkg.policy.defaultViews, pkg.uiPlan.slots);
  assert.deepEqual(pkg.policy.capabilities.requiredSkillIds, pkg.scenario.selectedSkillIds);
  assert.deepEqual(pkg.policy.capabilities.allowedToolIds, pkg.scenario.selectedToolIds);
  assert.deepEqual(pkg.policy.domainVocabulary.artifactTypes, pkg.scenario.outputArtifacts.map((artifact) => artifact.type));
  assert.deepEqual(
    pkg.policy.verifierPolicy.requiredInputs,
    pkg.scenario.inputContract.filter((field) => field.required).map((field) => field.key),
  );
  assert.deepEqual(pkg.policy.privacySafetyBoundaries.unsupportedTasks, pkg.scenario.scopeDeclaration.unsupportedTasks);
  assert.deepEqual(findScenarioPackagePolicyOnlyViolations(pkg), [], `${scenarioId} package should remain policy-only`);
  assert.equal(pkg.scenario.defaultSlots.length, pkg.uiPlan.slots.length);
  assert.ok(pkg.tests.length >= 1, `${scenarioId} should expose at least one package smoke test`);
  assert.deepEqual(
    pkg.tests[0].expectedArtifactTypes,
    pkg.scenario.outputArtifacts.map((artifact) => artifact.type),
    `${scenarioId} package smoke should assert every declared output artifact type`,
  );

  const smoke = await runScenarioRuntimeSmoke({ package: pkg, mode: 'dry-run' });
  assert.equal(smoke.ok, true, `${scenarioId} runtime dry-run smoke should pass`);
  assert.equal(smoke.packageRef.id, scenarioId);
  assert.deepEqual(smoke.expectedArtifactTypes, pkg.scenario.outputArtifacts.map((artifact) => artifact.type));
  assert.deepEqual(smoke.selectedSkillIds, pkg.scenario.selectedSkillIds);
}

const policyOnlyFixture = withScenarioPackagePolicy(buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z'));
const executionCodeViolations = findScenarioPackagePolicyOnlyViolations({
  ...policyOnlyFixture,
  policy: {
    ...policyOnlyFixture.policy,
    executionCode: 'await runScenario();',
  },
});
assert.ok(
  executionCodeViolations.some((violation) => violation.includes('policy.executionCode')),
  'scenario packages must reject embedded execution code',
);
assert.equal(
  validateRuntimeScenarioPackage(({
    ...policyOnlyFixture,
    policy: {
      ...policyOnlyFixture.policy,
      executionCode: 'await runScenario();',
    },
  }) as typeof policyOnlyFixture).ok,
  false,
  'runtime scenario package validation must reject embedded execution code',
);

const promptRegexViolations = findScenarioPackagePolicyOnlyViolations({
  ...policyOnlyFixture,
  policy: {
    ...policyOnlyFixture.policy,
    verifierPolicy: {
      ...policyOnlyFixture.policy?.verifierPolicy,
      promptRegex: '/paper|structure|omics/i',
    },
  },
});
assert.ok(
  promptRegexViolations.some((violation) => violation.includes('policy.verifierPolicy.promptRegex')),
  'scenario packages must reject prompt regex routing policy',
);

const runtimeLikePolicyFixtures = [
  {
    label: 'provider branches',
    package: {
      ...policyOnlyFixture,
      policy: {
        ...policyOnlyFixture.policy,
        capabilities: {
          ...policyOnlyFixture.policy?.capabilities,
          providerBranches: {
            openai: ['agentserver.generate.literature'],
            local: ['literature.pubmed_search'],
          },
        },
      },
    },
    expectedPath: 'policy.capabilities.providerBranches',
  },
  {
    label: 'multi-turn semantic judgment',
    package: {
      ...policyOnlyFixture,
      policy: {
        ...policyOnlyFixture.policy,
        verifierPolicy: {
          ...policyOnlyFixture.policy?.verifierPolicy,
          multiTurnSemanticJudge: 'infer whether the next turn is a repair request',
        },
      },
    },
    expectedPath: 'policy.verifierPolicy.multiTurnSemanticJudge',
  },
  {
    label: 'prompt special cases',
    package: {
      ...policyOnlyFixture,
      policy: {
        ...policyOnlyFixture.policy,
        domainVocabulary: {
          ...policyOnlyFixture.policy?.domainVocabulary,
          promptSpecialCases: ['if prompt mentions latest, force web backend'],
        },
      },
    },
    expectedPath: 'policy.domainVocabulary.promptSpecialCases',
  },
] as const;

for (const fixture of runtimeLikePolicyFixtures) {
  const violations = findScenarioPackagePolicyOnlyViolations(fixture.package);
  assert.ok(
    violations.some((violation) => violation.includes(fixture.expectedPath)),
    `scenario packages must reject ${fixture.label}`,
  );
  assert.equal(
    validateRuntimeScenarioPackage(fixture.package as typeof policyOnlyFixture).ok,
    false,
    `runtime scenario package validation must reject ${fixture.label}`,
  );
}

console.log(`[ok] official package smoke validated ${scenarioIds.length} built-in packages`);

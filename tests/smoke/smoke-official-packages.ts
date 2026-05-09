import assert from 'node:assert/strict';

import { scenarios, type ScenarioId } from '../../src/ui/src/data';
import { runScenarioRuntimeSmoke } from '@sciforge/scenario-core/runtime-smoke';
import {
  buildBuiltInScenarioPackage,
  findScenarioPackagePolicyOnlyViolations,
  SCENARIO_PACKAGE_POLICY_FIELDS,
} from '@sciforge/scenario-core/scenario-package';
import { validateScenarioPackage } from '@sciforge/scenario-core/validation-gate';

const scenarioIds = scenarios.map((scenario) => scenario.id);

for (const scenarioId of scenarioIds) {
  const pkg = buildBuiltInScenarioPackage(scenarioId as ScenarioId, '2026-04-25T00:00:00.000Z');
  const validation = validateScenarioPackage(pkg);
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

const policyOnlyFixture = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
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

console.log(`[ok] official package smoke validated ${scenarioIds.length} built-in packages`);

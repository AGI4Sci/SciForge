import assert from 'node:assert/strict';

import { scenarios, type ScenarioId } from '../../src/ui/src/data';
import { runScenarioRuntimeSmoke } from '../../src/ui/src/scenarioCompiler/runtimeSmoke';
import { buildBuiltInScenarioPackage } from '../../src/ui/src/scenarioCompiler/scenarioPackage';
import { validateScenarioPackage } from '../../src/ui/src/scenarioCompiler/validationGate';

const scenarioIds = scenarios.map((scenario) => scenario.id);

for (const scenarioId of scenarioIds) {
  const pkg = buildBuiltInScenarioPackage(scenarioId as ScenarioId, '2026-04-25T00:00:00.000Z');
  const validation = validateScenarioPackage(pkg);
  assert.equal(validation.ok, true, `${scenarioId} package should pass validation`);
  assert.equal(pkg.status, 'published', `${scenarioId} package should be published`);
  assert.equal(pkg.scenario.id, scenarioId);
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

console.log(`[ok] official package smoke validated ${scenarioIds.length} built-in packages`);

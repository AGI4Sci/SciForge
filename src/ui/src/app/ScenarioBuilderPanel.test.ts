import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { scenarioBuilderComponentDisplay, scenarioBuilderRecommendationReasons } from '@sciforge/scenario-core/scenario-builder-display-policy';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import type { ScenarioRuntimeOverride } from '../domain';
import { defaultElementSelectionForScenario, scenarioPackageToOverride } from './ScenarioBuilderPanel';

describe('ScenarioBuilderPanel scenario package policy integration', () => {
  it('uses scenario package display policy for builder recommendation copy', () => {
    const spec = SCENARIO_SPECS['literature-evidence-review'];
    const scenario: ScenarioRuntimeOverride = {
      title: spec.title,
      description: spec.description,
      skillDomain: spec.skillDomain,
      scenarioMarkdown: spec.scenarioMarkdown,
      defaultComponents: spec.componentPolicy.defaultComponents,
      allowedComponents: spec.componentPolicy.allowedComponents,
      fallbackComponent: spec.componentPolicy.fallbackComponent,
    };
    const selection = defaultElementSelectionForScenario('literature-evidence-review', scenario);
    const reasons = scenarioBuilderRecommendationReasons({
      selection,
      scenario,
      uiSlotCount: spec.defaultSlots.length,
      skillStepCount: selection.selectedSkillIds.length,
    });

    assert.ok(reasons.some((reason) => reason.includes('Artifact inspector')));
    assert.equal(selection.fallbackComponentId, spec.componentPolicy.fallbackComponent);
  });

  it('round-trips package component policy without inventing UI copy locally', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-05-10T00:00:00.000Z');
    const override = scenarioPackageToOverride(pkg);
    const display = scenarioBuilderComponentDisplay(override.fallbackComponent);

    assert.equal(override.fallbackComponent, pkg.scenario.fallbackComponentId);
    assert.equal(display.label, 'Artifact inspector');
  });
});

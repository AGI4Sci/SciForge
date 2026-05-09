import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { validateScenarioPackage } from '@sciforge/scenario-core/validation-gate';

describe('scenario package validation hook', () => {
  it('validates package contracts without executing workspace code', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const result = validateScenarioPackage(pkg);

    assert.equal(result.ok, true);
    assert.equal(pkg.id, 'literature-evidence-review');
    assert.ok(pkg.scenario.outputArtifacts.some((artifact) => artifact.type === 'paper-list'));
  });
});

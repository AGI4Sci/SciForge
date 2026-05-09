import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';

import { withScenarioPackagePolicy } from './scenario-package-policy.js';
import { validateRuntimeScenarioPackage } from './scenario-package-validation.js';

describe('runtime scenario package validation policy', () => {
  it('validates package readiness from the runtime policy boundary', () => {
    const pkg = withScenarioPackagePolicy(buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z'));
    const report = validateRuntimeScenarioPackage(pkg, undefined, '2026-04-25T00:00:00.000Z');

    assert.equal(report.ok, true);
    assert.equal(report.checkedAt, '2026-04-25T00:00:00.000Z');
    assert.equal(report.issues.some((issue) => issue.severity === 'error'), false);
  });

  it('blocks executable and prompt-regex fields at runtime validation', () => {
    const pkg = withScenarioPackagePolicy(buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z'));
    const report = validateRuntimeScenarioPackage(({
      ...pkg,
      policy: {
        ...pkg.policy,
        verifierPolicy: {
          ...pkg.policy?.verifierPolicy,
          promptRegex: '/paper|review/i',
        },
      },
    }) as typeof pkg, undefined, '2026-04-25T00:00:00.000Z');

    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.code === 'scenario-package-policy-only-violation'));
  });
});

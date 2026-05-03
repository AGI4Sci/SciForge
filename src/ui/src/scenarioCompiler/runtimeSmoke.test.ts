import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBuiltInScenarioPackage } from './scenarioPackage';
import { runScenarioRuntimeSmoke } from './runtimeSmoke';

describe('scenario runtime smoke hook', () => {
  it('dry-runs a package by validating contracts without executing workspace code', async () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const result = await runScenarioRuntimeSmoke({ package: pkg, mode: 'dry-run' });

    assert.equal(result.ok, true);
    assert.equal(result.mode, 'dry-run');
    assert.equal(result.packageRef.id, 'literature-evidence-review');
    assert.equal(result.execution?.status, 'skipped');
    assert.ok(result.expectedArtifactTypes.includes('paper-list'));
  });

  it('uses an optional executor for package skill smoke execution', async () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const result = await runScenarioRuntimeSmoke({ package: pkg, mode: 'execute-package-skill' }, async () => ({
      ok: true,
      execution: { status: 'done' },
    }));

    assert.equal(result.ok, true);
    assert.equal(result.execution?.status, 'done');
  });
});

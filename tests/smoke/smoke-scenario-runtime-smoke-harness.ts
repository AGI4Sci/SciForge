import assert from 'node:assert/strict';

import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { runScenarioRuntimeSmoke } from './scenario-runtime-smoke-harness';

const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');

const dryRun = await runScenarioRuntimeSmoke({ package: pkg, mode: 'dry-run' });
assert.equal(dryRun.ok, true);
assert.equal(dryRun.mode, 'dry-run');
assert.equal(dryRun.packageRef.id, 'literature-evidence-review');
assert.equal(dryRun.execution?.status, 'skipped');
assert.ok(dryRun.expectedArtifactTypes.includes('paper-list'));

const executed = await runScenarioRuntimeSmoke({ package: pkg, mode: 'execute-package-skill' }, async () => ({
  ok: true,
  execution: { status: 'done' },
}));
assert.equal(executed.ok, true);
assert.equal(executed.execution?.status, 'done');

console.log('[ok] scenario runtime smoke harness lives in tests/smoke and validates optional execution');

import assert from 'node:assert/strict';

import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { runScenarioRuntimeSmoke } from './scenario-runtime-smoke-harness';

const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');

const dryRun = await runScenarioRuntimeSmoke({ package: pkg, mode: 'dry-run' });
assert.equal(dryRun.ok, true);
assert.equal(dryRun.mode, 'dry-run');
assert.equal(dryRun.packageRef.id, 'literature-evidence-review');
assert.equal(dryRun.execution?.status, 'skipped');
assert.match(dryRun.execution?.reason ?? '', /without executing workspace code/);
assert.ok(dryRun.expectedArtifactTypes.includes('paper-list'));

console.log('[ok] scenario runtime smoke harness lives in tests/smoke and validates policy-only dry-runs');

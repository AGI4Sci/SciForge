import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import { buildScenarioQualityReport, diffScenarioPackages } from '@sciforge/scenario-core/scenario-quality-gate';

describe('scenario quality gate', () => {
  it('passes a valid built-in package without blocking items', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const report = buildScenarioQualityReport({ package: pkg, checkedAt: '2026-04-25T00:00:00.000Z' });

    assert.equal(report.ok, true);
    assert.equal(report.packageRef.id, pkg.id);
    assert.equal(report.items.some((item) => item.severity === 'blocking'), false);
  });

  it('blocks packages that fail validation', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const broken = {
      ...pkg,
      scenario: {
        ...pkg.scenario,
        selectedSkillIds: [],
      },
    };
    const report = buildScenarioQualityReport({ package: broken, checkedAt: '2026-04-25T00:00:00.000Z' });

    assert.equal(report.ok, false);
    assert.ok(report.items.some((item) => item.severity === 'blocking' && item.code === 'missing-selected-producer'));
  });

  it('reports version diffs for contract changes', () => {
    const previous = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const next = {
      ...previous,
      version: '2.0.0',
      scenario: {
        ...previous.scenario,
        outputArtifacts: [],
      },
    };
    const diff = diffScenarioPackages(previous, next);
    const report = buildScenarioQualityReport({ package: next, previousPackage: previous, checkedAt: '2026-04-25T00:00:00.000Z' });

    assert.equal(diff.outputArtifactsChanged, true);
    assert.ok(report.items.some((item) => item.code === 'contract-diff'));
  });

  it('includes runtime health in publish quality decisions', () => {
    const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
    const report = buildScenarioQualityReport({
      package: pkg,
      checkedAt: '2026-04-25T00:00:00.000Z',
      runtimeHealth: [
        { id: 'workspace', label: 'Workspace Writer', status: 'offline', detail: 'connection refused' },
        { id: 'agentserver', label: 'AgentServer', status: 'offline', detail: 'optional fallback unavailable' },
      ],
    });

    assert.equal(report.ok, false);
    assert.ok(report.items.some((item) => item.code === 'runtime-health-workspace-offline' && item.severity === 'blocking'));
    assert.ok(report.items.some((item) => item.code === 'runtime-health-agentserver-offline' && item.severity === 'warning'));
    assert.equal(report.runtimeHealth?.length, 2);
  });
});

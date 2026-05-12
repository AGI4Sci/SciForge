import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  builtInScenarioDisplayData,
  claimTypeDisplay,
  demoMessagesByScenario,
  demoTimeline,
  evidenceLevelDisplay,
  overviewStats,
  scenarioDisplayMatchesSpec,
} from './scenarioDemoData';
import { builtInScenarioIds } from './scenarioRoutingPolicy';
import { SCENARIO_SPECS } from './scenarioSpecs';

describe('scenario demo data policy', () => {
  it('owns built-in scenario display fixtures outside the UI shell', () => {
    assert.deepEqual(
      builtInScenarioDisplayData.map((scenario) => scenario.id).sort(),
      [...builtInScenarioIds].sort(),
    );
    assert.ok(scenarioDisplayMatchesSpec());
    assert.equal(
      builtInScenarioDisplayData.find((scenario) => scenario.id === 'structure-exploration')?.tools.includes('PDB'),
      true,
    );
  });

  it('keeps default display components compatible with scenario specs', () => {
    for (const scenario of builtInScenarioDisplayData) {
      const policy = SCENARIO_SPECS[scenario.id].componentPolicy;
      assert.ok(
        policy.allowedComponents.includes(scenario.defaultResult),
        `${scenario.id} default result must be allowed by its scenario package policy`,
      );
    }
  });

  it('provides demo messages and timeline items for every built-in scenario', () => {
    for (const scenarioId of builtInScenarioIds) {
      assert.ok(demoMessagesByScenario[scenarioId].length > 0, `${scenarioId} needs seeded chat messages`);
      assert.ok(demoTimeline.some((item) => item.scenario === scenarioId), `${scenarioId} needs a demo timeline item`);
    }
    assert.ok(demoTimeline.some((item) => item.action === 'run.running' && /Partial first result/i.test(item.title)));
    assert.ok(demoTimeline.some((item) => item.action === 'background.finalized' && /Background continuation/i.test(item.title)));
  });

  it('derives overview count from the display scenario list', () => {
    assert.equal(overviewStats[0]?.value, String(builtInScenarioDisplayData.length));
  });

  it('owns claim and evidence tag display policy for UI primitives', () => {
    assert.deepEqual(evidenceLevelDisplay('rct'), { label: 'RCT/临床', variant: 'info' });
    assert.deepEqual(claimTypeDisplay('hypothesis'), { label: '假设', variant: 'coral' });
  });
});

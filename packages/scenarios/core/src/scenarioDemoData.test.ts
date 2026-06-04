import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  builtInScenarioDisplayData,
  claimTypeDisplay,
  demoExecutionUnits,
  demoMessagesByScenario,
  demoPaperCards,
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

  it('does not provide default seed demo messages or timeline items', () => {
    for (const scenarioId of builtInScenarioIds) {
      assert.deepEqual(demoMessagesByScenario[scenarioId], [], `${scenarioId} should not ship seeded chat messages`);
    }
    assert.deepEqual(demoTimeline, []);
    assert.deepEqual(demoPaperCards, []);
    assert.deepEqual(demoExecutionUnits, []);
  });

  it('derives overview count from the display scenario list', () => {
    assert.equal(overviewStats[0]?.value, String(builtInScenarioDisplayData.length));
  });

  it('owns claim and evidence tag display policy for UI primitives', () => {
    assert.deepEqual(evidenceLevelDisplay('rct'), { label: 'RCT/临床', variant: 'info' });
    assert.deepEqual(claimTypeDisplay('hypothesis'), { label: '假设', variant: 'coral' });
  });
});

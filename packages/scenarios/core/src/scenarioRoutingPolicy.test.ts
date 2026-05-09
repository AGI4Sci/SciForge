import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SCENARIO_SPECS } from './scenarioSpecs';
import {
  builtInScenarioIdForRuntimeInput,
  builtInScenarioIds,
  matchedScenariosForPrompt,
  promptWithScopeCheck,
  scenarioIdBySkillDomain,
  scenarioIdForSkillDomain,
  scopeCheck,
  skillDomainForRuntimeInput,
} from './scenarioRoutingPolicy';

describe('scenarioRoutingPolicy', () => {
  it('derives the skill-domain scenario map from scenario specs', () => {
    const specScenarioIds = Object.keys(SCENARIO_SPECS).sort();

    assert.deepEqual([...builtInScenarioIds].sort(), specScenarioIds);
    for (const [scenarioId, spec] of Object.entries(SCENARIO_SPECS)) {
      assert.equal(scenarioIdBySkillDomain[spec.skillDomain], scenarioId);
      assert.equal(scenarioIdForSkillDomain(spec.skillDomain), scenarioId);
    }
  });

  it('normalizes runtime scenario and skill-domain inputs through package policy', () => {
    assert.equal(builtInScenarioIdForRuntimeInput({ scenarioId: 'structure-exploration' }), 'structure-exploration');
    assert.equal(builtInScenarioIdForRuntimeInput({
      scenarioId: 'structure-exploration',
      scenarioOverride: { skillDomain: 'omics' },
    }), 'omics-differential-exploration');
    assert.equal(builtInScenarioIdForRuntimeInput({ scenarioId: 'workspace-generated-scenario' }), 'literature-evidence-review');
    assert.equal(skillDomainForRuntimeInput({ scenarioId: 'biomedical-knowledge-graph' }), 'knowledge');
  });

  it('owns prompt domain signal matching for scope checks', () => {
    const matches = matchedScenariosForPrompt('Assess PubMed evidence, PDB structure, and RNA differential expression.');

    assert.ok(matches.includes('literature-evidence-review'));
    assert.ok(matches.includes('structure-exploration'));
    assert.ok(matches.includes('omics-differential-exploration'));
  });

  it('builds scope handoff prompts from package-owned policy', () => {
    const result = scopeCheck(
      'omics-differential-exploration',
      'Assess CRISPR screen efficiency, protein structure, and literature evidence.',
    );

    assert.equal(result.inScope, false);
    assert.ok(result.handoffTargets.includes('structure-exploration'));
    assert.match(result.promptPrefix, /staged plan/i);
    assert.match(promptWithScopeCheck('omics-differential-exploration', 'PDB and PubMed review'), /User prompt:/);
  });
});

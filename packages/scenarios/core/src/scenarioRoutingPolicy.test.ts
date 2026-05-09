import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SCENARIO_SPECS } from './scenarioSpecs';
import {
  builtInScenarioIdForRuntimeInput,
  builtInScenarioIds,
  createBuiltInScenarioRecord,
  defaultBuiltInScenarioId,
  matchedScenariosForPrompt,
  normalizeScenarioPromptTitle,
  promptWithScopeCheck,
  scenarioIdBySkillDomain,
  scenarioIdForSkillDomain,
  scenarioRuntimeOverrideForBuiltInScenario,
  scenarioRuntimeOverrideForRuntimeInput,
  scopeCheck,
  skillDomainForRuntimeInput,
  SUPPORTED_SCENARIO_SKILL_DOMAINS,
} from './scenarioRoutingPolicy';

describe('scenarioRoutingPolicy', () => {
  it('derives the skill-domain scenario map from scenario specs', () => {
    const specScenarioIds = Object.keys(SCENARIO_SPECS).sort();

    assert.deepEqual([...builtInScenarioIds].sort(), specScenarioIds);
    assert.deepEqual(
      [...SUPPORTED_SCENARIO_SKILL_DOMAINS].sort(),
      [...new Set(Object.values(SCENARIO_SPECS).map((spec) => spec.skillDomain))].sort(),
    );
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
    assert.equal(defaultBuiltInScenarioId, 'literature-evidence-review');
    assert.equal(builtInScenarioIdForRuntimeInput({ scenarioId: 'workspace-generated-scenario' }), defaultBuiltInScenarioId);
    assert.equal(skillDomainForRuntimeInput({ scenarioId: 'biomedical-knowledge-graph' }), 'knowledge');
  });

  it('builds app-facing scenario defaults from package-owned policy', () => {
    assert.deepEqual(createBuiltInScenarioRecord(0), {
      'literature-evidence-review': 0,
      'structure-exploration': 0,
      'omics-differential-exploration': 0,
      'biomedical-knowledge-graph': 0,
    });

    const structure = scenarioRuntimeOverrideForBuiltInScenario('structure-exploration');
    assert.equal(structure.skillDomain, 'structure');
    assert.equal(structure.fallbackComponent, SCENARIO_SPECS['structure-exploration'].componentPolicy.fallbackComponent);
    assert.equal(
      scenarioRuntimeOverrideForRuntimeInput({ scenarioId: 'workspace-generated-scenario', scenarioOverride: { skillDomain: 'knowledge' } }).skillDomain,
      'knowledge',
    );
  });

  it('normalizes prompt titles through package-owned policy', () => {
    assert.equal(normalizeScenarioPromptTitle('  a   b  '), 'a b');
    assert.equal(normalizeScenarioPromptTitle(''), '新聊天');
    assert.equal(normalizeScenarioPromptTitle('0123456789'.repeat(5)), '012345678901234567890123456789012345');
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

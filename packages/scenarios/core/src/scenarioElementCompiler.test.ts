import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inferDomainFromText, recommendScenarioElements } from './scenarioElementCompiler';

describe('scenarioElementCompiler recommendations', () => {
  it('prefers structured package and component context over incidental target/screen words', () => {
    const description = [
      'Build a workspace package for a protein structure viewer.',
      'The target screen should show PDB coordinates, ligand pockets, and residues.',
    ].join(' ');

    assert.equal(inferDomainFromText(description), 'structure');

    const recommendation = recommendScenarioElements(description);

    assert.ok(recommendation.selectedArtifactTypes.includes('structure-summary'));
    assert.ok(!recommendation.selectedArtifactTypes.includes('knowledge-graph'));
    assert.ok(!recommendation.selectedArtifactTypes.includes('omics-differential-expression'));
  });

  it('does not recommend elements from incidental lexical keywords alone', () => {
    const recommendation = recommendScenarioElements('target screen spatial matrix network summary workflow package');

    assert.deepEqual(recommendation.selectedSkillIds, []);
    assert.deepEqual(recommendation.selectedToolIds, []);
    assert.deepEqual(recommendation.selectedArtifactTypes, []);
    assert.deepEqual(recommendation.selectedComponentIds, ['unknown-artifact-inspector']);
  });

  it('does not select generated capability from broad workflow words without structured context', () => {
    const recommendation = recommendScenarioElements('build a workflow package and generate a summary report');

    assert.deepEqual(recommendation.selectedSkillIds, []);
    assert.deepEqual(recommendation.selectedArtifactTypes, []);
    assert.deepEqual(recommendation.selectedComponentIds, ['unknown-artifact-inspector']);
  });
});

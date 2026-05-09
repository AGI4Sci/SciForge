import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  scoreSkillByPackagePolicy,
  skillAllowedByPackagePolicy,
  type MatchableSkill,
  type MatchableSkillManifest,
} from './matching-policy';

function manifest(overrides: Partial<MatchableSkillManifest>): MatchableSkillManifest {
  return {
    id: 'test.skill',
    kind: 'package',
    description: 'Test package skill.',
    skillDomains: ['knowledge'],
    entrypoint: { type: 'markdown-skill' },
    examplePrompts: [],
    ...overrides,
  };
}

function skill(id: string): MatchableSkill {
  return { id, manifest: manifest({ id }) };
}

test('package matching policy favors SCP protein properties only outside BLAST intent', () => {
  const proteinProperties = manifest({
    id: 'scp.protein-properties-calculation',
    description: 'Calculate protein physicochemical properties and sequence metrics.',
    examplePrompts: ['protein properties calculation'],
  });
  const propertyPrompt = 'calculate protein physicochemical properties and instability for sequence MKWVTFISLL';
  const blastPrompt = 'BLASTP protein sequence alignment for homolog similarity';

  assert.ok(scoreSkillByPackagePolicy(proteinProperties, 'knowledge', propertyPrompt) >= 70);
  assert.ok(
    scoreSkillByPackagePolicy(proteinProperties, 'knowledge', blastPrompt)
      < scoreSkillByPackagePolicy(proteinProperties, 'knowledge', propertyPrompt),
  );
});

test('package matching policy gates provider-specific biomedical tools', () => {
  assert.equal(skillAllowedByPackagePolicy(skill('literature.pubmed_search'), 'web search KRAS papers'), false);
  assert.equal(skillAllowedByPackagePolicy(skill('literature.web_search'), 'web search KRAS papers'), true);
  assert.equal(skillAllowedByPackagePolicy(skill('sequence.ncbi_blastp_search'), 'BLASTP alignment for this protein'), true);
  assert.equal(skillAllowedByPackagePolicy(skill('sequence.ncbi_blastp_search'), 'calculate protein properties'), false);
  assert.equal(skillAllowedByPackagePolicy(skill('knowledge.uniprot_chembl_lookup'), 'virtual screening with SMILES docking'), false);
});

test('package matching policy keeps generic inspector away from biomedical execution prompts', () => {
  assert.equal(skillAllowedByPackagePolicy(skill('inspector.generic_file_table_log'), 'show this artifact json table'), true);
  assert.equal(skillAllowedByPackagePolicy(skill('inspector.generic_file_table_log'), 'show docking table for SMILES screening'), false);
});

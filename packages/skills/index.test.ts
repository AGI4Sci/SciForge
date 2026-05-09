import assert from 'node:assert/strict';
import { test } from 'node:test';

import { skillPackageManifests } from './index';
import { skillPackageManifests as catalogSkillPackageManifests } from './catalog';
import { discoverMarkdownSkillPackages, discoverMarkdownToolPackages } from './markdown-catalog';

test('skills public entry re-exports generated catalog without changing identity', () => {
  assert.equal(skillPackageManifests, catalogSkillPackageManifests);
  assert.ok(skillPackageManifests.length > 100);
  assert.ok(skillPackageManifests.some((skill) => skill.id === 'vision-gui-task'));
});

test('markdown catalog discovery owns provider and artifact inference', async () => {
  const skills = await discoverMarkdownSkillPackages();
  const tools = await discoverMarkdownToolPackages();
  const scpSkill = skills.find((skill) => skill.id === 'scp.drug-screening-docking');
  const pdfSkill = skills.find((skill) => skill.id === 'pdf-extract');

  assert.ok(scpSkill);
  assert.ok(scpSkill.tags.includes('scp'));
  assert.ok(scpSkill.outputArtifactTypes.includes('structure-summary'));
  assert.ok(pdfSkill);
  assert.ok(pdfSkill.skillDomains.includes('literature'));
  assert.ok(tools.some((tool) => tool.id === 'clawhub.playwright-mcp' && tool.provider === 'clawhub'));
});

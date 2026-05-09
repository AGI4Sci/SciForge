import assert from 'node:assert/strict';
import { test } from 'node:test';

import { skillPackageManifests } from './index';
import { skillPackageManifests as catalogSkillPackageManifests } from './catalog';
import { discoverMarkdownSkillPackages, discoverMarkdownToolPackages } from './markdown-catalog';
import {
  agentServerGenerationSkillAvailability,
  planSkillAvailabilityValidation,
  skillAvailabilityFailureReason,
} from './runtime-policy';

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

test('runtime policy owns fallback generation and entrypoint availability checks', () => {
  const fallback = agentServerGenerationSkillAvailability('literature', '2026-05-09T00:00:00.000Z');
  assert.equal(fallback.id, 'agentserver.generate.literature');
  assert.equal(fallback.manifest.outputArtifactSchema.type, 'runtime-artifact');
  assert.equal(fallback.manifest.entrypoint.type, 'agentserver-generation');

  const plan = planSkillAvailabilityValidation({
    id: 'workspace.generated',
    kind: 'workspace',
    description: 'Generated task.',
    skillDomains: ['knowledge'],
    inputContract: {},
    outputArtifactSchema: {},
    entrypoint: { type: 'workspace-task', path: './run.py' },
    environment: {},
    validationSmoke: {},
    examplePrompts: [],
    promotionHistory: [],
  }, { manifestPath: '/tmp/sciforge/skill.json', cwd: '/tmp/sciforge' });

  assert.equal(skillAvailabilityFailureReason(plan), undefined);
  assert.equal(plan.fileProbes.length, 1);
  assert.equal(plan.fileProbes[0].path, '/tmp/sciforge/run.py');
  assert.equal(skillAvailabilityFailureReason(plan, plan.fileProbes[0]), 'Entrypoint not found: /tmp/sciforge/run.py');
});

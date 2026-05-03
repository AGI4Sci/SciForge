import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import { skillPackageManifests } from '../../packages/skills';

const scpSkills = skillPackageManifests.filter((skill) => skill.id.startsWith('scp.'));

assert.equal(scpSkills.length, 121, 'SCP skill packages should be generated from the catalog');
assert.ok(scpSkills.length > 0, 'SCP skill packages should be available');

for (const skill of scpSkills) {
  assert.equal(skill.source, 'package', `${skill.id} source should be package`);
  await access(skill.docs.readmePath);
  const text = await readFile(skill.docs.readmePath, 'utf8');
  assert.ok(text.trim().length > 0, `${skill.id} SKILL.md should be readable`);
  assert.equal(skill.docs.readmePath.endsWith('/SKILL.md'), true, `${skill.id} should use SKILL.md as source`);
}

for (const id of ['scp.protein-properties-calculation', 'scp.molecular-properties-calculation', 'scp.sequence-alignment-pairwise']) {
  const manifest = scpSkills.find((skill) => skill.id === id);
  assert.ok(manifest, `${id} package manifest should exist`);
  assert.ok(manifest.packageRoot, `${id} package manifest should expose packageRoot`);
}

console.log(`[ok] packaged ${scpSkills.length} SCP markdown skills under packages/skills`);

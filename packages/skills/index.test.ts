import assert from 'node:assert/strict';
import { test } from 'node:test';

import { skillPackageManifests } from './index';
import { skillPackageManifests as catalogSkillPackageManifests } from './catalog';

test('skills public entry re-exports generated catalog without changing identity', () => {
  assert.equal(skillPackageManifests, catalogSkillPackageManifests);
  assert.ok(skillPackageManifests.length > 100);
  assert.ok(skillPackageManifests.some((skill) => skill.id === 'vision-gui-task'));
});

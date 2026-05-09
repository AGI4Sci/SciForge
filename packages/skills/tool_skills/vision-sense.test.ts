import assert from 'node:assert/strict';
import { test } from 'node:test';

import { skillPackageManifests } from '..';
import { toolPackageManifests } from './index';

test('vision sense package is discoverable as a tool skill with observe-only boundary', () => {
  const visionTool = toolPackageManifests.find((tool) => tool.id === 'local.vision-sense');

  assert.ok(visionTool);
  assert.equal(visionTool.toolType, 'sense-plugin');
  assert.equal(visionTool.docs.readmePath, 'packages/skills/tool_skills/local/vision-sense/SKILL.md');
  assert.equal(visionTool.packageRoot, 'packages/observe/vision');
  const tags = [...visionTool.tags] as string[];
  const requiredConfig = [...(visionTool.requiredConfig ?? [])] as string[];
  const outputFormats = [...(visionTool.sensePlugin?.outputContract.formats ?? [])] as string[];
  const outputContract = visionTool.sensePlugin?.outputContract as Record<string, unknown> | undefined;
  assert.ok(tags.includes('modality:vision'));
  assert.ok(tags.includes('text-output'));
  assert.ok(tags.includes('computer-use-input'));
  assert.ok(!tags.includes('gui'));
  assert.ok(!requiredConfig.includes('gui-executor'));
  assert.ok(requiredConfig.includes('trace-output-dir'));
  assert.equal(visionTool.sensePlugin?.inputContract.textField, 'text');
  assert.equal(visionTool.sensePlugin?.inputContract.modalitiesField, 'modalities');
  assert.ok(visionTool.sensePlugin?.inputContract.acceptedModalities.includes('screenshot'));
  assert.ok(visionTool.sensePlugin?.inputContract.acceptedModalities.includes('image'));
  assert.equal(visionTool.sensePlugin?.outputContract.kind, 'text');
  assert.ok(outputFormats.includes('text/plain'));
  assert.ok(!outputFormats.includes('text/x-computer-use-command'));
  assert.equal(outputContract?.commandSchema, undefined);
  assert.equal(visionTool.sensePlugin?.executionBoundary, 'text-signal-only');
  assert.equal(visionTool.sensePlugin?.safety.highRiskPolicy, 'reject');
  assert.match(visionTool.docs.agentSummary, /Computer Use execution is owned by a separate modular consumer\/provider/);
});

test('vision gui task skill points to the VisionTaskRequest template', () => {
  const visionSkill = skillPackageManifests.find((skill) => skill.id === 'vision-gui-task');

  assert.ok(visionSkill);
  assert.equal(
    visionSkill.inputContract.visionTaskRequest,
    'packages/observe/vision/sciforge_vision_sense/types.py:VisionTaskRequest',
  );
  assert.ok(visionSkill.requiredCapabilities.some((item) => item.capability === 'vision-sense'));
});

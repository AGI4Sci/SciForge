import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isHighRiskVisionSenseGuiRequest,
  looksLikeVisionSenseComputerUseRequest,
  parseVisionSenseAppAliases,
  requestedVisionSenseAppNameForPrompt,
  visionSenseCompletionPolicyModes,
  visionSenseFocusRegionGroundingId,
  visionSenseGroundingIds,
  visionSensePlannerPromptPolicy,
  visionSenseRuntimeEventTypes,
  visionSenseTraceIds,
} from './computer-use-runtime-policy';

test('vision-sense package owns runtime trace and grounding ids', () => {
  assert.equal(visionSenseTraceIds.tool, 'local.vision-sense');
  assert.equal(visionSenseTraceIds.trace, 'vision-sense-trace');
  assert.equal(visionSenseTraceIds.traceSchema, 'sciforge.vision-trace.v1');
  assert.equal(visionSenseRuntimeEventTypes.runtimeSelected, 'vision-sense-runtime-selected');
  assert.equal(visionSenseRuntimeEventTypes.genericAction, 'vision-sense-generic-action');
  assert.equal(visionSenseCompletionPolicyModes.oneSuccessfulNonWaitAction, 'one-successful-non-wait-action');
  assert.equal(visionSenseGroundingIds.coarseToFine, 'coarse-to-fine');
  assert.equal(visionSenseGroundingIds.kvGround, 'kv-ground');
  assert.equal(visionSenseFocusRegionGroundingId('kv-ground'), 'kv-ground-focus-region');
});

test('vision-sense package owns planner domain prompt policy', () => {
  assert.ok(visionSensePlannerPromptPolicy.domainTaskInstructions.length >= 3);
  assert.ok(visionSensePlannerPromptPolicy.domainTaskInstructions.some((instruction) => instruction.includes('document or slide creation tasks')));
  assert.ok(visionSensePlannerPromptPolicy.domainTaskInstructions.some((instruction) => instruction.includes('toolbar-or-ribbon actions')));
  assert.ok(visionSensePlannerPromptPolicy.highRiskActionInstruction.includes('requiresConfirmation=true'));
});

test('vision-sense package owns high-risk planner request policy', () => {
  assert.equal(isHighRiskVisionSenseGuiRequest('Submit the visible form.'), true);
  assert.equal(isHighRiskVisionSenseGuiRequest('点击发送按钮。'), true);
  assert.equal(isHighRiskVisionSenseGuiRequest('Inspect the settings.\nLater mention submit for context only.'), false);
});

test('vision-sense package owns computer-use intent prompt policy', () => {
  assert.equal(
    looksLikeVisionSenseComputerUseRequest('第二轮：基于上一轮结论，请挑出最值得跟进的 5 篇论文。不要重新检索，继续使用上一轮上下文。'),
    false,
  );
  assert.equal(looksLikeVisionSenseComputerUseRequest('点击浏览器里的搜索框并输入 KRAS G12D。'), true);
  assert.equal(
    looksLikeVisionSenseComputerUseRequest('Open the desktop presentation app and create a GUI Agent slide through computer use.'),
    true,
  );
});

test('vision-sense package owns app alias prompt line extraction policy', () => {
  const aliases = parseVisionSenseAppAliases(JSON.stringify({
    Browser: 'Google Chrome',
    browser: 'Should lose to longer case-insensitive boundary match order',
    浏览器: 'Safari',
  }));

  assert.equal(
    requestedVisionSenseAppNameForPrompt('\n  Click in Browser and type KRAS.\nIgnore later browser mentions.', aliases),
    'Google Chrome',
  );
  assert.equal(requestedVisionSenseAppNameForPrompt('打开浏览器并输入 KRAS。', aliases), 'Safari');
  assert.equal(requestedVisionSenseAppNameForPrompt('Use the filebrowser helper.', aliases), undefined);
  assert.deepEqual(parseVisionSenseAppAliases('{bad json'), {});
});

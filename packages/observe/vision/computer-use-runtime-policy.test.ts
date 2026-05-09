import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  visionSenseFocusRegionGroundingId,
  visionSenseGroundingIds,
  visionSenseTraceIds,
} from './computer-use-runtime-policy';

test('vision-sense package owns runtime trace and grounding ids', () => {
  assert.equal(visionSenseTraceIds.tool, 'local.vision-sense');
  assert.equal(visionSenseTraceIds.trace, 'vision-sense-trace');
  assert.equal(visionSenseTraceIds.traceSchema, 'sciforge.vision-trace.v1');
  assert.equal(visionSenseGroundingIds.coarseToFine, 'coarse-to-fine');
  assert.equal(visionSenseGroundingIds.kvGround, 'kv-ground');
  assert.equal(visionSenseFocusRegionGroundingId('kv-ground'), 'kv-ground-focus-region');
});

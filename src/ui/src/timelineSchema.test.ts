import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTimelineEventRecord, timelineEventSchema } from './timelineSchema';

test('timeline event schema covers package, run, artifact, handoff, failure, and export events', () => {
  for (const kind of ['package', 'run', 'artifact', 'handoff', 'failure', 'export'] as const) {
    assert.ok(timelineEventSchema.coveredEventKinds[kind].length, `missing timeline coverage for ${kind}`);
  }
});

test('timeline event validator rejects loose records without supported action prefix', () => {
  const valid = {
    id: 'timeline-test',
    actor: 'BioAgent Test',
    action: 'package.publish',
    subject: 'test-package@1.0.0',
    artifactRefs: [],
    executionUnitRefs: [],
    beliefRefs: [],
    branchId: 'test-package',
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: '2026-04-25T00:00:00.000Z',
  };
  assert.equal(isTimelineEventRecord(valid), true);
  assert.equal(isTimelineEventRecord({ ...valid, action: 'misc.note' }), false);
  assert.equal(isTimelineEventRecord({ ...valid, artifactRefs: [42] }), false);
});

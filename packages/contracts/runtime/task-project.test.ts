import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TASK_PROJECT_STATUSES,
  TASK_STAGE_STATUSES,
  type TaskProjectStatus,
  type TaskStageStatus,
} from './task-project';
import {
  TASK_PROJECT_STATUSES as INDEX_TASK_PROJECT_STATUSES,
  TASK_STAGE_STATUSES as INDEX_TASK_STAGE_STATUSES,
} from './index';

test('package task project contract owns project and stage statuses', () => {
  assert.deepEqual([...TASK_PROJECT_STATUSES], ['planned', 'running', 'done', 'failed', 'repair-needed', 'blocked']);
  assert.deepEqual([...TASK_STAGE_STATUSES], ['planned', 'running', 'done', 'failed', 'repair-needed', 'skipped', 'blocked']);

  const projectStatus: TaskProjectStatus = 'repair-needed';
  const stageStatus: TaskStageStatus = 'skipped';

  assert.equal(projectStatus, 'repair-needed');
  assert.equal(stageStatus, 'skipped');
});

test('package task project statuses are exported from the runtime contract index', () => {
  assert.equal(INDEX_TASK_PROJECT_STATUSES, TASK_PROJECT_STATUSES);
  assert.equal(INDEX_TASK_STAGE_STATUSES, TASK_STAGE_STATUSES);
});

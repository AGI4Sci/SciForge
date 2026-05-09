import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROJECT_TOOL_FAILED_EVENT_TYPE,
  WORKSPACE_RUNTIME_EVENT_TYPE,
  normalizeRuntimeContextCompactionStatus,
  normalizeRuntimeContextWindowStatus,
  projectToolFailureDetail,
  runtimeDetailIndicatesAbort,
  runtimeStreamEventLabel,
  workspaceRuntimeResultCompletion,
} from './events';

test('workspace runtime completion is derived from contract-level result status policy', () => {
  assert.deepEqual(workspaceRuntimeResultCompletion({
    executionUnits: [{ id: 'unit-1', status: 'done' }],
    artifacts: [{ id: 'artifact-1', type: 'any-output' }],
  }), { status: 'completed' });

  assert.deepEqual(workspaceRuntimeResultCompletion({
    executionUnits: [{ id: 'unit-2', status: 'failed-with-reason', failureReason: 'missing required input ref' }],
    artifacts: [{ id: 'artifact-2', type: 'any-output' }],
  }), { status: 'failed', reason: 'missing required input ref' });

  assert.deepEqual(workspaceRuntimeResultCompletion({
    message: 'result-bundle status=repair-needed',
  }), { status: 'failed', reason: 'result-bundle status=repair-needed' });
});

test('runtime context status normalization stays in runtime contract policy', () => {
  assert.equal(normalizeRuntimeContextWindowStatus(undefined, 0.9, 0.82), 'near-limit');
  assert.equal(normalizeRuntimeContextWindowStatus('window overflow', 0.4, 0.82), 'exceeded');
  assert.equal(normalizeRuntimeContextCompactionStatus('compressed'), 'completed');
  assert.equal(normalizeRuntimeContextCompactionStatus(undefined, { ok: false, message: 'backend error' }), 'failed');
});

test('runtime event projection exports stable fallback types and diagnostics', () => {
  assert.equal(WORKSPACE_RUNTIME_EVENT_TYPE, 'workspace-runtime-event');
  assert.equal(PROJECT_TOOL_FAILED_EVENT_TYPE, 'project-tool-failed');
  assert.equal(runtimeStreamEventLabel('tool-call', 'workspace-runtime', 'read_artifact'), '调用 read_artifact');
  assert.equal(runtimeDetailIndicatesAbort('request cancelled by user'), true);
  assert.equal(projectToolFailureDetail('network down'), 'SciForge project tool unavailable: network down');
});
